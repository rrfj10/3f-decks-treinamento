import http from 'node:http';
import { readFile, writeFile, mkdir, stat, rename, rm } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const envPath = path.resolve(__dirname, '..', '.env');
let envFileValues = {};
try {
  envFileValues = parseEnv(readFileSync(envPath, 'utf8'));
} catch {
  envFileValues = {};
}
const trainingRoot = path.resolve(process.env.TRAINING_ROOT || path.join(__dirname, '..', 'treinamentos'));
const deckRoot = path.join(trainingRoot, 'decks');
const catalogPath = path.join(trainingRoot, 'catalog.json');
const port = Number(process.env.PORT || 3000);
const catalogBaseUrl = process.env.CATALOG_BASE_URL || envFileValues.CATALOG_BASE_URL || '';
const requireAuth = String(process.env.GENERATOR_REQUIRE_AUTH ?? envFileValues.GENERATOR_REQUIRE_AUTH ?? 'true').toLowerCase() !== 'false';
const generatorApiKey = (process.env.GENERATOR_API_KEY || envFileValues.GENERATOR_API_KEY || '').trim();
const briefingLabelPattern = /^(titulo|título|nome do treinamento|tema|assunto|area|área|setor|publico|público|audiencia|audiência|objetivo|foco|duracao|duração|tempo|nivel|nível|conhecimento|tom|linguagem|quantidade de slides|qtd slides|slides|topicos|tópicos|atividade|dinamica|dinâmica|pratica|prática|avaliacao|avaliação|prova|quiz|tipo de operação|tipo de operacao|operação|operacao|kpi|indicador|dor operacional|problema operacional|impacto operacional|comportamento esperado|mudança esperada|mudanca esperada|evidência|evidencia|aprendizado)\s*:/i;

if (requireAuth && !generatorApiKey) {
  throw new Error('GENERATOR_API_KEY precisa estar configurada quando GENERATOR_REQUIRE_AUTH=true.');
}

// Hosts autorizados para chamadas de LLM. Sem essa lista, quem tiver a chave do
// gerador poderia apontar a API para um host proprio e receber o briefing junto
// com o header Authorization contendo a chave da LLM.
const defaultLlmHosts = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.groq.com',
  'api.deepseek.com',
  'api.mistral.ai',
  'api.cohere.com'
].join(',');
const llmAllowedHosts = new Set(
  String(process.env.LLM_ALLOWED_HOSTS || envFileValues.LLM_ALLOWED_HOSTS || defaultLlmHosts)
    .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
);
const llmTimeoutMs = Number(process.env.LLM_TIMEOUT_MS || envFileValues.LLM_TIMEOUT_MS || 60_000);
const trustProxy = String(process.env.TRUST_PROXY ?? envFileValues.TRUST_PROXY ?? 'false').toLowerCase() === 'true';
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || envFileValues.MAX_BODY_BYTES || 1_200_000);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * A interface do gerador nao usa handler inline nem script de terceiro: so o
 * app.js local, o <style> embutido e as fontes/icones do Google e do cdnjs. Por
 * isso da para manter script-src em 'self', sem 'unsafe-inline'.
 * img-src precisa incluir a origem do catalogo, de onde a UI carrega as logos.
 */
function buildContentSecurityPolicy() {
  const catalogOrigin = (() => {
    try {
      return new URL(catalogBaseUrl).origin;
    } catch {
      return '';
    }
  })();
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    `img-src 'self' data:${catalogOrigin ? ` ${catalogOrigin}` : ''}`,
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'content-security-policy': buildContentSecurityPolicy(),
  // Redundante com frame-ancestors, mantido para navegador antigo que so entende
  // o header legado. O gerador nunca precisa ser embutido em iframe.
  'x-frame-options': 'DENY'
};

/** Erro cuja mensagem pode ser devolvida ao cliente. Os demais viram 500 generico. */
class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.expose = true;
  }
}

function json(res, status, data) {
  res.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function assertAllowedLlmUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    throw new RequestError('A URL da API precisa ser uma URL valida.');
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new RequestError('A URL da API precisa usar https:// (http:// so e aceito em localhost).');
  }
  if (!llmAllowedHosts.has(host)) {
    throw new RequestError(`Host da LLM nao autorizado: ${host}. Libere em LLM_ALLOWED_HOSTS.`);
  }
  return parsed.toString();
}

function slugify(value) {
  return String(value || 'treinamento')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    // O corte vem antes da limpeza das pontas: aparando primeiro, um titulo longo
    // ainda podia terminar em hifen depois do slice e gerar "nome-_v1.html".
    .slice(0, 72).replace(/^-+|-+$/g, '') || 'treinamento';
}

/**
 * Grava o deck no primeiro slug livre. Usa flag 'wx' para que a checagem de
 * existencia e a escrita sejam uma operacao so - duas geracoes simultaneas com o
 * mesmo titulo nao podem mais receber a mesma versao e sobrescrever uma a outra.
 */
async function writeUniqueDeck(areaDir, title, html) {
  const base = slugify(title);
  for (let version = 1; version <= 999; version += 1) {
    const fileSlug = `${base}_v${version}.html`;
    try {
      await writeFile(path.join(areaDir, fileSlug), html, { flag: 'wx' });
      return { fileSlug, version: `v${version}` };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new RequestError('Limite de versões atingido para este treinamento.');
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Aceita apenas escalares. Objetos e arrays viram o fallback em vez de "[object Object]". */
function text(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Remove marcador de lista ("- ", "* ", "1. ", "2) ") do inicio da linha.
 * Exige o espaco depois do marcador para nao comer numero do proprio conteudo:
 * "3.5 minutos de TMA" virava "5 minutos de TMA" com o padrao anterior.
 */
function stripListMarker(line) {
  return String(line ?? '').replace(/^\s*(?:[-*•–]|\d{1,2}[.)])\s+/, '').trim();
}

function looksLikeListLine(line) {
  return /^\s*(?:[-*•–]|\d{1,2}[.)])\s+/.test(String(line ?? ''));
}

function hostOf(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function comparableText(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeLines(value) {
  const seen = new Set();
  return String(value || '').split(/\n+/)
    .map(stripListMarker)
    .filter((line) => {
      const key = comparableText(line);
      if (!key || seen.has(key) || briefingLabelPattern.test(line)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

function mergeDescription(current, next) {
  const seen = new Set();
  const lines = [];
  for (const source of [current, next]) {
    for (const line of String(source || '').split(/\n+/)) {
      const clean = stripListMarker(line);
      const key = comparableText(clean);
      if (!key || seen.has(key) || briefingLabelPattern.test(clean)) continue;
      seen.add(key);
      lines.push(clean);
    }
  }
  return lines.join('\n');
}

function firstKeywordMatch(text, groups) {
  const normalized = comparableText(text);
  for (const group of groups) {
    if (group.terms.some((term) => normalized.includes(comparableText(term)))) return group.value;
  }
  return '';
}

function inferOperationalBriefing(messages) {
  const text = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content || '')
    .join('\n');

  const operationType = firstKeywordMatch(text, [
    { value: 'SAC', terms: ['sac', 'atendimento receptivo', 'receptivo', 'cliente liga'] },
    { value: 'Televendas', terms: ['televendas', 'vendas', 'conversao', 'conversão', 'vph', 'campanha ativa'] },
    { value: 'Retenção', terms: ['retencao', 'retenção', 'churn', 'cancelamento', 'reversao'] },
    { value: 'Cobrança', terms: ['cobranca', 'cobrança', 'inadimplencia', 'inadimplência', 'negociacao'] },
    { value: 'Suporte', terms: ['suporte', 'help desk', 'tecnico', 'técnico'] },
    { value: 'NOC', terms: ['noc', 'tempo real', 'fila atual', 'degradacao', 'degradação'] },
    { value: 'MIS', terms: ['mis', 'relatorio', 'relatório', 'indicadores', 'dashboard', 'bi'] },
    { value: 'Planejamento', terms: ['planejamento', 'forecast', 'escala', 'dimensionamento', 'wfm'] },
    { value: 'Qualidade', terms: ['qualidade', 'monitoria', 'nota de monitoria', 'fcr', 'csat', 'rechamada'] },
    { value: 'RH', terms: ['rh', 'feedback', 'desenvolvimento', 'treinamento comportamental'] },
    { value: 'Liderança', terms: ['lideranca', 'liderança', 'supervisor', 'coordenador', 'gestor'] }
  ]);

  const kpiTarget = firstKeywordMatch(text, [
    { value: 'NS / Nível de Serviço', terms: ['nivel de servico', 'nível de serviço', 'ns', 'sla'] },
    { value: 'TMA', terms: ['tma', 'tempo medio de atendimento', 'tempo médio de atendimento'] },
    { value: 'TME', terms: ['tme', 'tempo medio de espera', 'tempo médio de espera', 'fila'] },
    { value: 'Taxa de Abandono', terms: ['abandono', 'abandonadas'] },
    { value: 'Aderência', terms: ['aderencia', 'aderência', 'escala'] },
    { value: 'Absenteísmo', terms: ['absenteismo', 'absenteísmo', 'faltas', 'atrasos'] },
    { value: 'Qualidade / Monitoria', terms: ['qualidade', 'monitoria', 'nota'] },
    { value: 'Conversão', terms: ['conversao', 'conversão', 'vendas', 'vph'] },
    { value: 'Retenção', terms: ['retencao', 'retenção', 'churn', 'cancelamento'] },
    { value: 'Retrabalho / Rechamada', terms: ['retrabalho', 'rechamada', 'recontato', 'fcr'] },
    { value: 'Governança', terms: ['governanca', 'governança', 'auditoria', 'aprovacao', 'aprovação'] }
  ]);

  const operationalPain = firstKeywordMatch(text, [
    { value: 'Fila e espera acima do desejado', terms: ['fila', 'espera', 'tme'] },
    { value: 'Atendimentos longos ou pouco objetivos', terms: ['tma', 'demora', 'atendimento longo'] },
    { value: 'Queda de qualidade ou falha de procedimento', terms: ['qualidade', 'monitoria', 'procedimento', 'erro'] },
    { value: 'Baixa conversão comercial', terms: ['conversao', 'conversão', 'vendas'] },
    { value: 'Risco de governança e rastreabilidade', terms: ['governanca', 'governança', 'auditoria', 'rastreabilidade'] },
    { value: 'Baixa aderência à escala', terms: ['aderencia', 'aderência', 'escala'] },
    { value: 'Falta de alinhamento comportamental', terms: ['feedback', 'lideranca', 'liderança', 'comportamento'] }
  ]);

  const inferred = {};
  if (operationType) inferred.operationType = operationType;
  if (kpiTarget) inferred.kpiTarget = kpiTarget;
  if (operationalPain) inferred.operationalPain = operationalPain;
  if (/roleplay|simula|dinamica|dinâmica|atividade|pratica|prática|exercicio|exercício/i.test(text)) inferred.practice = 'Sim';
  if (/quiz|prova|avaliacao|avaliação|checagem|certifica/i.test(text)) inferred.evaluation = 'Sim';
  return inferred;
}

function normalizeBriefing(briefing = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(isPlainObject(briefing) ? briefing : {})) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    clean[key] = key === 'description' ? dedupeLines(text) : text;
  }
  return clean;
}

const authWindowMs = 60_000;
const authMaxAttempts = 10;
const authAttempts = new Map();

/**
 * Atras de nginx/Traefik todo mundo chega com o IP do proxy, entao o balde de
 * tentativas vira global: 10 chutes errados de um atacante trancavam a operacao
 * inteira. Com TRUST_PROXY=true o IP sai do primeiro salto do x-forwarded-for.
 * Fica desligado por padrao porque esse header e forjavel em exposicao direta.
 */
function clientIp(req) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

function isAuthThrottled(req) {
  const entry = authAttempts.get(clientIp(req));
  if (!entry || Date.now() - entry.start > authWindowMs) return false;
  return entry.count >= authMaxAttempts;
}

function recordAuthFailure(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now - entry.start > authWindowMs) authAttempts.set(ip, { start: now, count: 1 });
  else entry.count += 1;
  if (authAttempts.size > 5000) {
    for (const [key, value] of authAttempts) {
      if (now - value.start > authWindowMs) authAttempts.delete(key);
    }
  }
}

function hasValidGeneratorKey(req) {
  if (!requireAuth) return true;
  const received = String(req.headers['x-api-key'] || '').trim();
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(generatorApiKey);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

/**
 * Valida a chave aplicando limite de tentativas por IP, para que os endpoints de
 * autenticacao nao funcionem como oraculo de forca bruta.
 */
function checkGeneratorKey(req) {
  if (!requireAuth) return { ok: true, status: 200 };
  if (isAuthThrottled(req)) {
    console.warn(`[auth] tentativas excessivas de ${clientIp(req)}`);
    return { ok: false, status: 429, error: 'Muitas tentativas. Aguarde um minuto e tente novamente.' };
  }
  if (!hasValidGeneratorKey(req)) {
    recordAuthFailure(req);
    return { ok: false, status: 401, error: 'Chave de acesso invalida ou ausente.' };
  }
  authAttempts.delete(clientIp(req));
  return { ok: true, status: 200 };
}

function requireGeneratorKey(req, res) {
  const result = checkGeneratorKey(req);
  if (result.ok) return true;
  json(res, result.status, { error: result.error });
  return false;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      // Sem req.destroy() aqui: matar o socket antes de responder fazia o cliente
      // receber ECONNRESET e nunca ver o 413. Sair do laco ja pausa a leitura, e o
      // Node encerra a conexao sozinho ao terminar a resposta com o corpo pendente.
      throw new RequestError('Payload muito grande.', 413);
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError('JSON invalido no corpo da requisição.');
  }
  if (!isPlainObject(parsed)) throw new RequestError('O corpo da requisição precisa ser um objeto JSON.');
  return parsed;
}

async function readCatalog() {
  try {
    return JSON.parse(await readFile(catalogPath, 'utf8'));
  } catch {
    return { trainings: [] };
  }
}

async function readEnvFile() {
  try {
    return await readFile(envPath, 'utf8');
  } catch {
    return '';
  }
}

function parseEnv(content) {
  return Object.fromEntries(content.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return null;
    const index = trimmed.indexOf('=');
    return [trimmed.slice(0, index), trimmed.slice(index + 1)];
  }).filter(Boolean));
}

/**
 * Reescreve o .env preservando comentarios, ordem e linhas em branco do arquivo
 * original. Chaves novas sao acrescentadas no fim.
 */
function serializeEnv(values, originalContent = '') {
  const remaining = new Map(Object.entries(values));
  const output = [];
  for (const line of String(originalContent || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      output.push(line);
      continue;
    }
    const key = trimmed.slice(0, trimmed.indexOf('='));
    if (!remaining.has(key)) continue;
    output.push(`${key}=${remaining.get(key) ?? ''}`);
    remaining.delete(key);
  }
  while (output.length && !output.at(-1).trim()) output.pop();
  for (const [key, value] of remaining) output.push(`${key}=${value ?? ''}`);
  return `${output.join('\n')}\n`;
}

/**
 * Escreve em arquivo temporario e renomeia, para que uma queda no meio da escrita
 * nao corrompa o .env (que guarda GENERATOR_API_KEY e impede o boot se invalido).
 * Em container o .env costuma ser um bind mount de arquivo, onde rename falha -
 * nesse caso cai para escrita direta.
 */
async function writeEnvFile(content) {
  const tempPath = `${envPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content);
    await rename(tempPath, envPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    if (!['EBUSY', 'EXDEV', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
    await writeFile(envPath, content);
  }
}

async function readLlmConfig() {
  const envValues = parseEnv(await readEnvFile());
  const activeSlot = Number(envValues.LLM_ACTIVE_SLOT || process.env.LLM_ACTIVE_SLOT || 1);
  const slots = Array.from({ length: 5 }, (_, offset) => {
    const slot = offset + 1;
    const label = envValues[`LLM_SLOT_${slot}_LABEL`] || `API ${slot}`;
    const model = envValues[`LLM_SLOT_${slot}_MODEL`] || envValues.LLM_MODEL || 'gpt-4.1-mini';
    const apiUrl = envValues[`LLM_SLOT_${slot}_API_URL`] || envValues.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
    const apiKey = envValues[`LLM_SLOT_${slot}_API_KEY`] || '';
    return { slot, label, model, apiUrl, configured: Boolean(apiKey) };
  });
  const active = slots.find((item) => item.slot === activeSlot) || slots[0];
  const apiKey = envValues.LLM_API_KEY || envValues.OPENAI_API_KEY || envValues[`LLM_SLOT_${active.slot}_API_KEY`] || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  return {
    activeSlot: active.slot,
    slots,
    configured: Boolean(apiKey),
    model: envValues.LLM_MODEL || active.model || process.env.LLM_MODEL || 'gpt-4.1-mini',
    apiUrl: envValues.LLM_API_URL || active.apiUrl || process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions'
  };
}

async function readLlmRuntimeConfig() {
  const envValues = parseEnv(await readEnvFile());
  const activeSlot = Number(envValues.LLM_ACTIVE_SLOT || process.env.LLM_ACTIVE_SLOT || 1);
  return {
    apiKey: envValues.LLM_API_KEY || envValues.OPENAI_API_KEY || envValues[`LLM_SLOT_${activeSlot}_API_KEY`] || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    model: envValues.LLM_MODEL || envValues[`LLM_SLOT_${activeSlot}_MODEL`] || process.env.LLM_MODEL || 'gpt-4.1-mini',
    apiUrl: envValues.LLM_API_URL || envValues[`LLM_SLOT_${activeSlot}_API_URL`] || process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions'
  };
}

function providerFromLlmConfig({ label = '', model = '', apiUrl = '' } = {}) {
  const textValue = `${label} ${model} ${apiUrl}`.toLowerCase();
  if (textValue.includes('deepseek')) return 'deepseek';
  if (textValue.includes('openrouter')) return 'openrouter';
  if (textValue.includes('groq')) return 'groq';
  if (textValue.includes('mistral')) return 'mistral';
  if (textValue.includes('anthropic') || textValue.includes('claude')) return 'anthropic';
  if (textValue.includes('gemini') || textValue.includes('google')) return 'google';
  if (textValue.includes('openai') || textValue.includes('gpt-')) return 'openai';
  return '';
}

function assertConsistentLlmProvider({ label, model, apiUrl }) {
  const provider = providerFromLlmConfig({ label, model });
  if (!provider) return;
  const urlHost = new URL(apiUrl).hostname.toLowerCase();
  const expectedHosts = {
    deepseek: ['deepseek.com'],
    openrouter: ['openrouter.ai'],
    groq: ['groq.com'],
    mistral: ['mistral.ai'],
    anthropic: ['anthropic.com'],
    google: ['googleapis.com'],
    openai: ['openai.com']
  };
  const allowed = expectedHosts[provider] || [];
  if (allowed.length && !allowed.some((host) => urlHost === host || urlHost.endsWith(`.${host}`))) {
    throw new RequestError(`Modelo/provedor ${provider} nao combina com a URL ${urlHost}. Ajuste a URL da API antes de salvar.`);
  }
}

/**
 * Chave ja gravada no slot, mas SO se o host novo for o mesmo do host que a
 * chave atende. A allowlist garante que o destino e um provedor conhecido, nao
 * que ele seja o dono da chave: sem esta amarra, quem tivesse a GENERATOR_API_KEY
 * mandava apiUrl de outro provedor da lista e sem apiKey, e o servidor entregava
 * a chave guardada como Bearer para esse terceiro.
 */
function reusableSlotKey(envValues, slot, apiUrl) {
  const targetHost = hostOf(apiUrl);
  const candidates = [
    [envValues[`LLM_SLOT_${slot}_API_KEY`], envValues[`LLM_SLOT_${slot}_API_URL`] || envValues.LLM_API_URL],
    [envValues.LLM_API_KEY, envValues.LLM_API_URL],
    [envValues.OPENAI_API_KEY, 'https://api.openai.com/v1/chat/completions']
  ];
  let blockedHost = '';
  for (const [key, url] of candidates) {
    if (!key) continue;
    const storedHost = hostOf(url);
    if (!storedHost || storedHost === targetHost) return key;
    blockedHost ||= storedHost;
  }
  if (blockedHost) {
    throw new RequestError(
      `A chave salva pertence a ${blockedHost}. Informe a chave de ${targetHost || 'novo provedor'} antes de trocar a URL.`,
      400
    );
  }
  return '';
}

async function saveLlmConfig(input) {
  const slotNumber = Number(input.slot);
  const slot = Number.isFinite(slotNumber) ? Math.min(5, Math.max(1, Math.trunc(slotNumber))) : 1;
  const label = text(input.label) || `API ${slot}`;
  const originalContent = await readEnvFile();
  const envValues = parseEnv(originalContent);
  const model = text(input.model) || 'gpt-4.1-mini';
  const apiUrl = assertAllowedLlmUrl(text(input.apiUrl) || 'https://api.openai.com/v1/chat/completions');
  const apiKey = text(input.apiKey) || reusableSlotKey(envValues, slot, apiUrl);
  if (!apiKey) throw new RequestError('Informe a chave da LLM.');
  assertConsistentLlmProvider({ label, model, apiUrl });

  const values = {
    ...envValues,
    LLM_ACTIVE_SLOT: String(slot),
    LLM_API_KEY: apiKey,
    LLM_MODEL: model,
    LLM_API_URL: apiUrl,
    [`LLM_SLOT_${slot}_LABEL`]: label,
    [`LLM_SLOT_${slot}_API_KEY`]: apiKey,
    [`LLM_SLOT_${slot}_MODEL`]: model,
    [`LLM_SLOT_${slot}_API_URL`]: apiUrl
  };
  await writeEnvFile(serializeEnv(values, originalContent));
  envFileValues = values;
  process.env.LLM_ACTIVE_SLOT = String(slot);
  process.env.LLM_API_KEY = apiKey;
  process.env.LLM_MODEL = model;
  process.env.LLM_API_URL = apiUrl;
  return readLlmConfig();
}

function llmModelsUrl(apiUrl) {
  const parsed = new URL(assertAllowedLlmUrl(apiUrl));
  const parts = parsed.pathname.split('/').filter(Boolean);
  const versionIndex = parts.findIndex((part) => /^v\d+$/i.test(part));
  const chatIndex = parts.findIndex((part) => /^(chat|messages|completions)$/i.test(part));
  const baseParts = versionIndex >= 0
    ? parts.slice(0, versionIndex + 1)
    : parts.slice(0, Math.max(0, chatIndex));
  parsed.pathname = `/${[...baseParts, 'models'].join('/')}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

async function listLlmModels(input = {}) {
  const envValues = parseEnv(await readEnvFile());
  const slotNumber = Number(input.slot);
  const slot = Number.isFinite(slotNumber) ? Math.min(5, Math.max(1, Math.trunc(slotNumber))) : Number(envValues.LLM_ACTIVE_SLOT || 1);
  const apiUrl = text(input.apiUrl) || envValues[`LLM_SLOT_${slot}_API_URL`] || envValues.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
  // Mesma amarra do saveLlmConfig: a chave guardada so segue para o host que ela
  // atende, nunca para outro provedor da allowlist escolhido pelo chamador.
  const apiKey = text(input.apiKey) || reusableSlotKey(envValues, slot, apiUrl);
  if (!apiKey) throw new RequestError('Informe a chave da API para carregar os modelos.');
  const modelsUrl = llmModelsUrl(apiUrl);
  const response = await fetch(modelsUrl, {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(Math.min(llmTimeoutMs, 20_000))
  });
  if (!response.ok) throw new RequestError(`Nao foi possivel carregar modelos. A API respondeu HTTP ${response.status}.`, 502);
  const payload = await response.json();
  const models = Array.isArray(payload.data)
    ? payload.data.map((item) => text(item.id)).filter(Boolean)
    : [];
  return { modelsUrl, models: [...new Set(models)].sort((a, b) => a.localeCompare(b)) };
}

// Fila serial para o catalogo: ler-alterar-gravar sem lock perdia entradas quando
// duas geracoes rodavam ao mesmo tempo.
let catalogQueue = Promise.resolve();

function withCatalogLock(task) {
  const run = catalogQueue.then(task, task);
  catalogQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function writeCatalog(entry) {
  return withCatalogLock(async () => {
    const catalog = await readCatalog();
    const trainings = Array.isArray(catalog.trainings) ? catalog.trainings : [];
    const existing = trainings.filter((item) => item.file !== entry.file);
    catalog.trainings = [...existing, entry].sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  });
}

function extractChartSeriesFromText(value) {
  const source = String(value || '');
  const pairs = [];
  const pattern = /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s/%.-]{1,42}?)\s+(?:atual|real|esperado|meta)?\s*[:=-]?\s*(-?\d+(?:[,.]\d+)?)(\s*%|\s*minutos?|\s*min)?/gi;
  let match;
  while ((match = pattern.exec(source)) && pairs.length < 8) {
    const label = match[1].replace(/(?:atual|real|esperado|meta)$/i, '').trim();
    const number = Number(String(match[2]).replace(',', '.'));
    if (label && Number.isFinite(number)) pairs.push({ label, value: number });
  }
  return pairs;
}

function shouldCreateFallbackChart(input) {
  const source = comparableText([
    input.title,
    input.theme,
    input.objective,
    input.description,
    input.kpiTarget,
    input.learningEvidence
  ].join(' '));
  return /(^|\s)(grafico|grafica|graficos|graficas)(\s|$)|linha|pizza|coluna|barra|funil|arvore de decisao|tendencia/.test(source);
}

function fallbackVisualPatternType(input) {
  const source = comparableText([
    input.title,
    input.theme,
    input.objective,
    input.description,
    input.learningEvidence
  ].join(' '));
  if (!/(infografico|visual|premium|dashboard|numero|resultado|objetivo|meta|plano|preco|produto|servico|quem somos|missao|visao|valor|timeline|linha do tempo|processo|etapa|jornada|fluxo)/.test(source)) return '';
  if (/(plano|preco|precos|valor mensal|pacote|investimento)/.test(source)) return 'pricing-table';
  if (/(objetivo|meta|metas|alvo)/.test(source)) return 'objective-board';
  if (/(produto|servico|servicos|quem somos|missao|visao|valores)/.test(source)) return 'icon-columns';
  if (/(timeline|linha do tempo|cronograma|periodo)/.test(source)) return 'infographic-timeline';
  if (/(processo|etapa|jornada|passo|fluxo)/.test(source)) return 'radial-steps';
  if (/(numero|numeros|resultado|dashboard|kpi|indicador|performance|desempenho)/.test(source)) return 'metric-donut';
  return 'kpi-row';
}

function fallbackVisualPatternSlide(input) {
  const type = fallbackVisualPatternType(input);
  if (type === 'pricing-table') {
    return {
      type,
      title: 'Planos de acompanhamento',
      lead: 'Comparativo visual de opções para apoiar a decisão operacional.',
      items: [
        { icon: 'fa-circle-check', title: 'Plano Básico', text: 'R$ 500,00; Diagnóstico inicial; Checklist operacional; Relatório de resultados' },
        { icon: 'fa-circle-check', title: 'Plano Médio', text: 'R$ 700,00; Planejamento estratégico; Acompanhamento quinzenal; Suporte por e-mail' },
        { icon: 'fa-circle-check', title: 'Plano Premium', text: 'R$ 900,00; Consultoria completa; Relatórios avançados; Suporte prioritário' }
      ]
    };
  }
  if (type === 'objective-board') {
    return {
      type,
      title: 'Objetivos operacionais',
      lead: 'Metas práticas que o treinamento deve apoiar na rotina.',
      items: [
        { icon: 'fa-circle-check', title: 'Expandir consistência', text: text(input.objective) || 'Padronizar a execução do processo.' },
        { icon: 'fa-circle-check', title: 'Aumentar resultado', text: text(input.kpiTarget) || 'Melhorar o indicador acompanhado pela liderança.' },
        { icon: 'fa-circle-check', title: 'Otimizar rotina', text: text(input.behaviorChange) || 'Reduzir retrabalho e acelerar decisões.' }
      ]
    };
  }
  if (type === 'icon-columns') {
    return {
      type,
      title: 'Pilares do treinamento',
      lead: 'Resumo visual dos pontos que sustentam a aplicação prática.',
      items: [
        { icon: 'fa-bullseye', title: 'Missão', text: text(input.objective) || 'Alinhar a execução ao resultado esperado.' },
        { icon: 'fa-eye', title: 'Visão', text: 'Ser referência em clareza, qualidade e consistência operacional.' },
        { icon: 'fa-gem', title: 'Valores', text: 'Foco no cliente, responsabilidade e melhoria contínua.' }
      ]
    };
  }
  if (type === 'infographic-timeline') {
    return {
      type,
      title: 'Linha do tempo de aplicação',
      lead: 'Sequência recomendada para levar o conteúdo à operação.',
      items: [
        { icon: 'fa-1', title: 'Diagnosticar', text: 'Identificar cenário, KPI e dor operacional.' },
        { icon: 'fa-2', title: 'Treinar', text: 'Praticar comportamento e regra de decisão.' },
        { icon: 'fa-3', title: 'Aplicar', text: 'Executar na rotina com acompanhamento.' },
        { icon: 'fa-4', title: 'Medir', text: 'Comparar evidências antes e depois.' }
      ]
    };
  }
  if (type === 'radial-steps') {
    return {
      type,
      title: 'Etapas do método',
      lead: 'Mapa visual para explicar o caminho de execução.',
      items: [
        { icon: 'fa-magnifying-glass-chart', title: 'Ler indicador', text: 'Entender o dado antes da ação.' },
        { icon: 'fa-comments', title: 'Orientar time', text: 'Traduzir o dado em conduta esperada.' },
        { icon: 'fa-list-check', title: 'Acompanhar', text: 'Validar execução com evidência.' },
        { icon: 'fa-arrow-trend-up', title: 'Ajustar', text: 'Corrigir rota conforme o resultado.' }
      ]
    };
  }
  return {
    type,
    title: type === 'metric-donut' ? 'Resultados em números' : 'Indicadores principais',
    lead: 'Painel visual para destacar indicadores e metas do treinamento.',
    items: [
      { icon: 'fa-face-smile', title: 'Satisfação', text: '67% dos clientes' },
      { icon: 'fa-arrow-trend-up', title: 'Performance', text: '90% de aumento' },
      { icon: 'fa-user-check', title: 'Retenção', text: '19% de retenção' }
    ]
  };
}

function fallbackChartSlide(input) {
  const source = [input.description, input.kpiTarget, input.objective].join('\n');
  const pairs = extractChartSeriesFromText(source);
  const labels = pairs.length ? pairs.map((pair) => pair.label) : ['Atual', 'Meta', 'Esperado'];
  const values = pairs.length ? pairs.map((pair) => pair.value) : [82, 90, 88];
  const wanted = comparableText([input.title, input.theme, input.description].join(' '));
  const type = wanted.includes('pizza')
    ? 'chart-pie'
    : wanted.includes('funil')
      ? 'chart-funnel'
      : wanted.includes('linha') || wanted.includes('tendencia')
        ? 'chart-line'
        : wanted.includes('arvore de decisao')
          ? 'decision-tree'
          : 'chart-bar';
  if (type === 'decision-tree') {
    return {
      type,
      title: 'Árvore de decisão operacional',
      lead: 'Use a árvore para decidir a ação a partir do indicador observado.',
      items: [
        { icon: 'fa-question', title: 'Indicador fora da meta?', text: 'Sim: investigue a causa. Não: mantenha o monitoramento.' },
        { icon: 'fa-code-branch', title: 'Capacidade ou processo?', text: 'Capacidade: ajuste escala. Processo: reforce roteiro e acompanhamento.' },
        { icon: 'fa-flag-checkered', title: 'Ação final', text: text(input.behaviorChange) || 'Registre a ação e reavalie o indicador no próximo ciclo.' }
      ]
    };
  }
  return {
    type,
    title: type === 'chart-line' ? 'Tendência dos indicadores' : type === 'chart-funnel' ? 'Funil operacional' : type === 'chart-pie' ? 'Distribuição dos indicadores' : 'Comparativo visual dos indicadores',
    lead: 'Gráfico visual gerado a partir dos dados informados no briefing.',
    chart: {
      labels,
      unit: source.includes('%') ? '%' : '',
      series: [{ name: text(input.kpiTarget) || 'Indicador', values }]
    }
  };
}

function fallbackPlan(rawInput) {
  const input = isPlainObject(rawInput) ? rawInput : {};
  const title = text(input.title) || text(input.theme) || 'Novo Treinamento';
  const area = text(input.area) || text(input.operationType) || 'geral';
  const audience = text(input.audience) || 'operação interna';
  const objective = text(input.objective) || 'Padronizar conhecimento e orientar a execução.';
  const kpiTarget = text(input.kpiTarget) || 'Indicador operacional definido no briefing';
  const operationalPain = text(input.operationalPain) || 'Necessidade de padronizar a execução';
  const behaviorChange = text(input.behaviorChange) || 'Aplicar o processo com mais clareza, consistência e responsabilidade.';
  const learningEvidence = text(input.learningEvidence) || text(input.evaluation) || 'Checagem final de entendimento';
  const raw = text(input.description);
  const topics = raw.split(/\n+/)
    .map(stripListMarker)
    .filter((line) => line && !briefingLabelPattern.test(line))
    .slice(0, 8);
  const core = topics.length ? topics : [
    'Contexto da operação',
    'Problema ou risco atual',
    'Indicadores impactados',
    'Conduta ou processo esperado',
    'Exemplo prático',
    'Erros comuns',
    'Boas práticas',
    'Atividade ou simulação',
    'Checagem de aprendizado'
  ];

  return normalizePlan({
    title,
    area,
    subtitle: `Treinamento para ${audience}`,
    objective,
    operationType: text(input.operationType) || area,
    kpiTarget,
    operationalPain,
    behaviorChange,
    learningEvidence,
    slides: [
      { type: 'cover', title, subtitle: objective },
      { type: 'cards', title: 'Objetivos do treinamento', items: [
        { icon: 'fa-bullseye', title: 'Clareza', text: objective },
        { icon: 'fa-users', title: 'Público', text: audience },
        { icon: 'fa-circle-check', title: 'Aplicação', text: 'Transformar conteúdo em rotina prática.' }
      ] },
      { type: 'cards', title: 'Impacto operacional', lead: 'Conecte o treinamento com a rotina e os indicadores acompanhados pela liderança.', items: [
        { icon: 'fa-chart-line', title: 'KPI impactado', text: kpiTarget },
        { icon: 'fa-triangle-exclamation', title: 'Dor operacional', text: operationalPain },
        { icon: 'fa-user-check', title: 'Comportamento esperado', text: behaviorChange }
      ] },
      ...(shouldCreateFallbackChart(input) ? [fallbackChartSlide(input)] : []),
      ...(fallbackVisualPatternType(input) ? [fallbackVisualPatternSlide(input)] : []),
      ...core.map((topic, index) => ({
        type: index % 3 === 0 ? 'checklist' : index % 3 === 1 ? 'cards' : 'flow',
        title: topic,
        lead: `Pontos essenciais sobre ${topic.toLowerCase()}.`,
        items: [
          { icon: 'fa-circle-check', title: 'Entender', text: `O que precisa ficar claro sobre ${topic}.` },
          { icon: 'fa-list-check', title: 'Aplicar', text: 'Como levar o conceito para a rotina.' },
          { icon: 'fa-triangle-exclamation', title: 'Evitar', text: 'Erros comuns e pontos de atenção.' }
        ]
      })),
      { type: 'closing', title: 'Encerramento', subtitle: `Evidência de aprendizado: ${learningEvidence}. Revise os pontos principais e alinhe dúvidas antes de aplicar na operação.` }
    ]
  });
}

const planSchemaInstruction = `Responda apenas JSON valido, sem markdown. Schema:
{"title":"string","area":"string","subtitle":"string","objective":"string","operationType":"string","kpiTarget":"string","operationalPain":"string","behaviorChange":"string","learningEvidence":"string","slides":[{"type":"cover|cards|checklist|flow|table|chart-bar|chart-line|chart-pie|chart-funnel|decision-tree|metric-donut|kpi-row|infographic-timeline|radial-steps|process-map|icon-columns|pricing-table|objective-board|performance-summary|closing","title":"string","subtitle":"string","lead":"string","items":[{"icon":"fa-name","title":"string","text":"string"}],"rows":[["col1","col2"]],"chart":{"labels":["string"],"unit":"string","series":[{"name":"string","values":[1,2,3],"color":"#F0C55A"}]}}]}.
Use chart-bar para barras/colunas, chart-line para linha/tendencia temporal, chart-pie para pizza/participacao, chart-funnel para funil por etapa e decision-tree para arvore de decisao. Para graficos visuais, preencha chart.labels e chart.series com numeros reais; nao simule graficos apenas com tabela. Use metric-donut ou kpi-row para resultados em numeros/KPIs, infographic-timeline para cronologia, radial-steps para etapas circulares, process-map para fluxo visual, icon-columns para quem somos/produtos/servicos, pricing-table para planos/precos e objective-board para objetivos/metas.`;

/**
 * Unico ponto de saida para a LLM: valida o host, aplica timeout e nao propaga o
 * corpo da resposta de erro do provedor (que pode ecoar dados da requisicao).
 */
async function llmFetch({ apiKey, apiUrl, model }, { system, user, temperature }) {
  const url = assertAllowedLlmUrl(apiUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user, null, 2) }
      ]
    }),
    signal: AbortSignal.timeout(llmTimeoutMs)
  });
  if (!response.ok) throw new Error(`LLM respondeu HTTP ${response.status}.`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return JSON.parse(content.replace(/^```json\s*|\s*```$/g, ''));
}

async function llmPlan(input) {
  const runtime = await readLlmRuntimeConfig();
  if (!runtime.apiKey) return { plan: fallbackPlan(input), mode: 'fallback', warning: 'LLM_API_KEY/OPENAI_API_KEY nao configurada.' };

  try {
    const parsed = await llmFetch(runtime, {
      temperature: 0.35,
      system: `Voce cria roteiros de treinamentos corporativos em pt-BR para decks HTML da 3F Contact Center. Para temas de contact center, conecte o conteudo a tipo de operacao, KPI, dor operacional, comportamento esperado, pratica e evidencia de aprendizado. ${planSchemaInstruction}`,
      user: input
    });
    return { plan: normalizePlan(parsed), mode: 'llm' };
  } catch (error) {
    return { plan: fallbackPlan(input), mode: 'fallback', warning: `Falha na LLM: ${error.message}` };
  }
}

function requestedSlideCount(instruction) {
  const text = String(instruction || '');
  const match = text.match(/(?:reduz|reduza|deixe|ajuste|para|em)\D{0,24}(\d{1,2})\s*slides?/i)
    || text.match(/(\d{1,2})\s*slides?/i);
  if (!match) return 0;
  return Math.min(24, Math.max(3, Number(match[1])));
}

function withSlideLimit(plan, target) {
  if (!target || plan.slides.length <= target) return plan;
  const cover = plan.slides.find((slide) => slide.type === 'cover') || plan.slides[0];
  const closing = [...plan.slides].reverse().find((slide) => slide.type === 'closing') || plan.slides.at(-1);
  const body = plan.slides.filter((slide) => slide !== cover && slide !== closing);
  const priority = [
    'Objetivos do treinamento',
    'Impacto operacional',
    'Contexto da operação',
    'Indicadores impactados',
    'Conduta ou processo esperado',
    'Avaliação final',
    'Atividade prática',
    'Exemplo da operação'
  ];
  const ordered = [
    ...priority.map((title) => body.find((slide) => comparableText(slide.title) === comparableText(title))).filter(Boolean),
    ...body.filter((slide) => !priority.some((title) => comparableText(slide.title) === comparableText(title)))
  ];
  const middle = ordered.slice(0, Math.max(1, target - 2));
  // cover e closing podem ser o mesmo objeto num plano de slide unico; o filter
  // remove a duplicata em vez de renderizar o slide duas vezes.
  const kept = [cover, ...middle, closing].filter((slide, index, list) => slide && list.indexOf(slide) === index);
  return normalizePlan({ ...plan, slides: kept });
}

function hasSlide(plan, title) {
  return plan.slides.some((slide) => comparableText(slide.title) === comparableText(title));
}

function addRevisionSlides(plan, instruction, briefing = {}) {
  const wanted = comparableText(instruction);
  const slides = [...plan.slides];
  // Sem Math.max: quando nao existe slide de encerramento, os slides novos vao
  // para o fim, e nao para antes da capa.
  const closingIndex = slides.findIndex((slide) => slide.type === 'closing');
  const insertAt = closingIndex === -1 ? slides.length : closingIndex;

  // Os testes rodam sobre `wanted` (sem acento e minusculo). Testar o `instruction`
  // cru fazia "dinâmica" nao casar com a alternativa "dinamica" da lista.
  if (/(dinamica|atividade|simulacao|roleplay|pratica)/.test(wanted) && !hasSlide(plan, 'Atividade prática')) {
    slides.splice(insertAt, 0, {
      type: 'cards',
      title: 'Atividade prática',
      lead: 'Simulação rápida para transformar o conteúdo em comportamento observável.',
      items: [
        { icon: 'fa-headset', title: 'Cenário', text: briefing.operationalPain || 'Use uma situação real da operação.' },
        { icon: 'fa-users', title: 'Execução', text: 'Divida o grupo em atendimento, cliente e observador.' },
        { icon: 'fa-clipboard-check', title: 'Debriefing', text: 'Compare a condução com o comportamento esperado.' }
      ]
    });
  }

  if (/(avaliacao|quiz|prova|checagem|certifica)/.test(wanted) && !hasSlide(plan, 'Avaliação final')) {
    slides.splice(Math.min(insertAt + 1, slides.length), 0, {
      type: 'checklist',
      title: 'Avaliação final',
      lead: 'Checagem curta para confirmar entendimento antes da aplicação.',
      items: [
        { icon: 'fa-circle-check', title: 'Conceito', text: 'O participante explica o objetivo do treinamento.' },
        { icon: 'fa-list-check', title: 'Aplicação', text: 'O participante escolhe a conduta correta em um cenário.' },
        { icon: 'fa-chart-line', title: 'Indicador', text: `O participante conecta a prática ao KPI ${briefing.kpiTarget || plan.kpiTarget || 'definido'}.` }
      ]
    });
  }

  if (/exemplo|caso|cenario/.test(wanted) && !hasSlide(plan, 'Exemplo da operação')) {
    slides.splice(insertAt, 0, {
      type: 'cards',
      title: 'Exemplo da operação',
      lead: 'Use um caso simples para aproximar o conteúdo da rotina.',
      items: [
        { icon: 'fa-triangle-exclamation', title: 'Situação', text: briefing.operationalPain || 'Cliente em atendimento com risco de desvio de processo.' },
        { icon: 'fa-user-check', title: 'Conduta esperada', text: briefing.behaviorChange || plan.behaviorChange || 'Aplicar o processo combinado.' },
        { icon: 'fa-chart-line', title: 'Resultado esperado', text: briefing.kpiTarget || plan.kpiTarget || 'Melhoria do indicador definido.' }
      ]
    });
  }

  const revised = normalizePlan({ ...plan, slides });
  if (wanted.includes('pratico') || wanted.includes('pratica') || wanted.includes('operador')) {
    revised.slides = revised.slides.map((slide) => slide.type === 'cover' ? slide : {
      ...slide,
      lead: slide.lead || 'Foque no que deve ser feito na rotina.',
      items: slide.items.map((item) => ({
        ...item,
        text: item.text || 'Aplicar este ponto em uma situação real de atendimento.'
      }))
    });
  }
  return normalizePlan(revised);
}

function fallbackRevisePlan(plan, instruction, briefing = {}) {
  let revised = normalizePlan(plan || fallbackPlan(briefing));
  const wanted = comparableText(instruction);
  const target = requestedSlideCount(instruction);

  revised = addRevisionSlides(revised, instruction, briefing);
  if (target) revised = withSlideLimit(revised, target);

  if (wanted.includes('tom') || wanted.includes('lideranca') || wanted.includes('gestor')) {
    revised.subtitle = revised.subtitle || 'Versão revisada para aplicação com liderança';
    revised.slides = revised.slides.map((slide) => slide.type === 'cover' ? slide : {
      ...slide,
      lead: slide.lead || 'Conecte o conteúdo com orientação, acompanhamento e rotina de gestão.'
    });
  }

  return normalizePlan(revised);
}

async function llmRevisePlan(input) {
  const runtime = await readLlmRuntimeConfig();
  // fallbackRevisePlan roda sobre um plan vindo do cliente; se ele lancar aqui
  // fora, o erro escapa ate o handler global. Fica dentro do try.
  try {
    if (!runtime.apiKey) {
      return {
        plan: fallbackRevisePlan(input.plan, input.instruction, input.briefing || {}),
        mode: 'fallback',
        warning: 'LLM_API_KEY/OPENAI_API_KEY nao configurada.'
      };
    }
    const parsed = await llmFetch(runtime, {
      temperature: 0.25,
      system: `Voce revisa roteiros de treinamentos 3F em pt-BR. Preserve o template, mantenha uma ideia principal por slide, respeite o pedido do usuario e nao reinicie o briefing. ${planSchemaInstruction}`,
      user: input
    });
    const revised = addRevisionSlides(normalizePlan(parsed), input.instruction, input.briefing || {});
    return { plan: withSlideLimit(revised, requestedSlideCount(input.instruction)), mode: 'llm' };
  } catch (error) {
    return {
      plan: fallbackRevisePlan(input.plan, input.instruction, input.briefing || {}),
      mode: 'fallback',
      warning: `Falha na LLM: ${error.message}`
    };
  }
}

function extractBriefingFromMessages(messages, currentBriefing = {}) {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')?.content || '';
  const slideBlock = lastUser.match(/(?:slides?|topicos|tópicos)\s*:\s*([\s\S]+)/i)?.[1] || '';
  const bulletLike = lastUser.split(/\n+/).filter(looksLikeListLine).length >= 2;
  const linesSource = slideBlock || (bulletLike ? lastUser : '');
  const lines = linesSource.split(/\n+/)
    .map(stripListMarker)
    .filter((line) => line && !briefingLabelPattern.test(line));
  const briefing = normalizeBriefing({
    title: currentBriefing.title || '',
    theme: currentBriefing.theme || '',
    area: currentBriefing.area || '',
    audience: currentBriefing.audience || '',
    objective: currentBriefing.objective || '',
    duration: currentBriefing.duration || '',
    level: currentBriefing.level || '',
    tone: currentBriefing.tone || '',
    slideTarget: currentBriefing.slideTarget || '',
    practice: currentBriefing.practice || '',
    evaluation: currentBriefing.evaluation || '',
    operationType: currentBriefing.operationType || '',
    kpiTarget: currentBriefing.kpiTarget || '',
    operationalPain: currentBriefing.operationalPain || '',
    behaviorChange: currentBriefing.behaviorChange || '',
    learningEvidence: currentBriefing.learningEvidence || '',
    description: currentBriefing.description || ''
  });

  const patterns = [
    ['title', /(?:titulo|título|nome do treinamento)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['theme', /(?:tema|assunto)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['area', /(?:area|área|setor)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['audience', /(?:publico|público|audiencia|audiência)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['objective', /(?:objetivo|foco)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['duration', /(?:duracao|duração|tempo)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['level', /(?:nivel|nível|conhecimento)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['tone', /(?:tom|linguagem)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['slideTarget', /(?:quantidade de slides|qtd slides)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['practice', /(?:atividade|dinamica|dinâmica|pratica|prática)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['evaluation', /(?:avaliacao|avaliação|prova|quiz)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['operationType', /(?:tipo de operação|tipo de operacao|operação|operacao)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['kpiTarget', /(?:kpi|indicador|indicador impactado)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['operationalPain', /(?:dor operacional|problema operacional|impacto operacional)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['behaviorChange', /(?:comportamento esperado|mudança esperada|mudanca esperada)[ \t]*[:=-][ \t]*([^\n]+)/i],
    ['learningEvidence', /(?:evidência|evidencia|evidência de aprendizado|evidencia de aprendizado|aprendizado)[ \t]*[:=-][ \t]*([^\n]+)/i]
  ];

  for (const [key, pattern] of patterns) {
    for (const message of messages) {
      if (message.role !== 'user') continue;
      const match = String(message.content || '').match(pattern);
      if (match) briefing[key] = match[1].split('\n')[0].trim();
    }
  }

  const inferred = inferOperationalBriefing(messages);
  for (const [key, value] of Object.entries(inferred)) {
    if (!briefing[key]) briefing[key] = value;
  }

  if (!briefing.title && lines.length) briefing.title = lines[0].slice(0, 80);
  if (!briefing.title && briefing.theme) briefing.title = briefing.theme;
  briefing.description = mergeDescription(briefing.description, lines.join('\n'));

  return normalizeBriefing(briefing);
}

function briefingSlides(briefing) {
  return dedupeLines(briefing.description).split(/\n+/)
    .filter(Boolean)
    .slice(0, 10);
}

function localChatReply(messages, briefing) {
  const missing = [];
  if (!briefing.title && !briefing.theme) missing.push('título ou tema');
  if (!briefing.audience) missing.push('público-alvo');
  if (!briefing.objective) missing.push('objetivo');
  if (!briefing.duration) missing.push('duração');
  if (!briefing.kpiTarget && !briefing.behaviorChange) missing.push('KPI impactado ou comportamento esperado');

  if (missing.length) {
    return `Entendi. Para deixar o treinamento pronto para gerar, ainda preciso de: ${missing.join(', ')}.\n\nPode responder em texto livre ou neste formato:\nTítulo: ...\nTema: ...\nÁrea: ...\nPúblico: ...\nObjetivo: ...\nDuração: ...\nKPI: ...\nComportamento esperado: ...\nSlides:\n- ...\n- ...`;
  }

  const slideCount = fallbackPlan(briefing).slides.length;
  return `Briefing suficiente para gerar um primeiro rascunho.\n\nResumo:\n- Título: ${briefing.title || briefing.theme}\n- Tema: ${briefing.theme || 'Ainda não informado'}\n- Área: ${briefing.area || briefing.operationType || 'Ainda não informado'}\n- Público: ${briefing.audience}\n- Objetivo: ${briefing.objective}\n- Duração: ${briefing.duration}\n- KPI/impacto: ${briefing.kpiTarget || briefing.behaviorChange}\n- Estrutura estimada: ${slideCount} slides\n\nSe quiser, refine exemplos, tom de voz ou pontos obrigatórios. Caso contrário, clique em "Gerar treinamento".`;
}

async function chatWithAssistant(input) {
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .filter(isPlainObject)
    .map((message) => ({ role: text(message.role), content: text(message.content) }))
    .slice(-20);
  const briefing = extractBriefingFromMessages(messages, isPlainObject(input.briefing) ? input.briefing : {});
  const draftPlan = fallbackPlan(briefing);
  const runtime = await readLlmRuntimeConfig();
  const { apiKey } = runtime;

  if (!apiKey) {
    return {
      mode: 'fallback',
      briefing,
      draftPlan,
      reply: localChatReply(messages, briefing),
      warning: 'LLM_API_KEY/OPENAI_API_KEY nao configurada.'
    };
  }

  const system = `Voce e um consultor de design instrucional da 3F Contact Center.
Ajude o usuario a refinar o briefing de um treinamento corporativo.
Responda apenas JSON valido com este schema:
{"reply":"mensagem curta em pt-BR","briefing":{"title":"string","theme":"string","area":"string","audience":"string","objective":"string","duration":"string","level":"string","tone":"string","slideTarget":"string","practice":"string","evaluation":"string","operationType":"string","kpiTarget":"string","operationalPain":"string","behaviorChange":"string","learningEvidence":"string","description":"topicos dos slides em linhas"}}
Nao gere HTML. Nao invente dados especificos quando faltar contexto; faca perguntas objetivas. Para temas de contact center, classifique tipo de operacao, KPI impactado, dor operacional e comportamento esperado quando o usuario fornecer sinais suficientes.`;

  try {
    const parsed = await llmFetch(runtime, {
      temperature: 0.35,
      system,
      user: { briefing, messages }
    });
    const parsedBriefing = isPlainObject(parsed) && isPlainObject(parsed.briefing) ? parsed.briefing : {};
    const mergedBriefing = normalizeBriefing({ ...briefing, ...inferOperationalBriefing(messages), ...parsedBriefing });
    return {
      mode: 'llm',
      briefing: mergedBriefing,
      draftPlan: fallbackPlan(mergedBriefing),
      reply: text(parsed?.reply) || localChatReply(messages, mergedBriefing)
    };
  } catch (error) {
    return {
      mode: 'fallback',
      briefing,
      draftPlan,
      reply: localChatReply(messages, briefing),
      warning: `Falha na LLM: ${error.message}`
    };
  }
}

const chartColors = ['#F0C55A', '#5E88C1', '#74FF9F', '#FF8A5C', '#BFA7FF', '#60D6C8'];
const visualPatternTypes = ['metric-donut', 'kpi-row', 'infographic-timeline', 'radial-steps', 'process-map', 'icon-columns', 'pricing-table', 'objective-board', 'performance-summary'];
const slideTypes = ['cover', 'cards', 'checklist', 'flow', 'table', 'chart-bar', 'chart-line', 'chart-pie', 'chart-funnel', 'decision-tree', ...visualPatternTypes, 'closing'];

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeColor(value, index = 0) {
  const color = text(value);
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  return chartColors[index % chartColors.length];
}

function inferChartFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return { labels: [], unit: '', series: [] };
  const body = rows.slice(1).filter((row) => Array.isArray(row) && row.length >= 2);
  const labels = body.map((row) => text(row[0])).filter(Boolean).slice(0, 8);
  const values = body.map((row) => numberValue(row[1])).slice(0, labels.length);
  return labels.length ? { labels, unit: '', series: [{ name: text(rows[0]?.[1]) || 'Valor', values }] } : { labels: [], unit: '', series: [] };
}

function normalizeChart(rawChart, rows = []) {
  const source = isPlainObject(rawChart) ? rawChart : inferChartFromRows(rows);
  const labels = (Array.isArray(source.labels) ? source.labels : [])
    .map((label) => text(label))
    .filter(Boolean)
    .slice(0, 10);
  const rawSeries = Array.isArray(source.series) ? source.series : [];
  const series = rawSeries.slice(0, 4).map((entry, index) => {
    const item = isPlainObject(entry) ? entry : {};
    const values = (Array.isArray(item.values) ? item.values : []).slice(0, labels.length || 10).map(numberValue);
    return {
      name: text(item.name) || `Série ${index + 1}`,
      color: safeColor(item.color, index),
      values
    };
  }).filter((entry) => entry.values.length);
  if (!series.length) {
    return {
      labels: ['Atual', 'Meta', 'Esperado'],
      unit: '',
      series: [{ name: 'Valor', color: chartColors[0], values: [82, 90, 88] }]
    };
  }
  return {
    labels: labels.length ? labels : series[0]?.values.map((_, index) => `Item ${index + 1}`) || [],
    unit: text(source.unit),
    series
  };
}

/**
 * Normaliza um slide vindo da LLM ou do cliente. Cada elemento e validado, nao
 * so o array que o contem: `slides:[null]` ou `rows:["a","b"]` chegavam ate o
 * render e derrubavam a requisicao.
 */
function normalizeSlide(slide) {
  const source = isPlainObject(slide) ? slide : {};
  return {
    type: slideTypes.includes(source.type) ? source.type : 'cards',
    title: text(source.title) || 'Slide',
    subtitle: text(source.subtitle),
    lead: text(source.lead),
    items: (Array.isArray(source.items) ? source.items : []).slice(0, 6).map((item) => {
      const entry = isPlainObject(item) ? item : {};
      return {
        icon: (text(entry.icon) || 'fa-circle-check').replace(/^fas\s+/, ''),
        title: text(entry.title) || text(entry.titulo) || 'Ponto',
        text: text(entry.text) || text(entry.texto)
      };
    }),
    rows: (Array.isArray(source.rows) ? source.rows : [])
      .slice(0, 8)
      .map((row) => (Array.isArray(row) ? row : [row]).slice(0, 8).map((cell) => text(cell))),
    chart: normalizeChart(source.chart, source.rows)
  };
}

function emptySlide(type, title, subtitle) {
  return { type, title, subtitle, lead: '', items: [], rows: [] };
}

const maxSlides = 24;

function normalizePlan(plan) {
  const source = isPlainObject(plan) ? plan : {};
  const title = text(source.title) || text(source.titulo) || 'Novo Treinamento';
  const area = text(source.area) || 'geral';
  const normalized = (Array.isArray(source.slides) ? source.slides : []).map(normalizeSlide);
  if (!normalized.length || normalized[0].type !== 'cover') {
    normalized.unshift(emptySlide('cover', title, text(source.objective) || text(source.subtitle)));
  }
  // O encerramento sai da fila antes do corte e volta no fim, sempre. Cortar com
  // ele ainda no array descartava o proprio slide de encerramento em planos que
  // batiam no limite, e o deck terminava no meio do conteudo.
  const closing = normalized.at(-1)?.type === 'closing'
    ? normalized.pop()
    : emptySlide('closing', 'Encerramento', 'Obrigado pela participação.');
  const bodySlides = normalized.filter((slide) => slide.type !== 'closing');
  const slides = [...bodySlides.slice(0, maxSlides - 1), closing];
  return {
    title,
    area,
    subtitle: text(source.subtitle),
    objective: text(source.objective),
    operationType: text(source.operationType),
    kpiTarget: text(source.kpiTarget),
    operationalPain: text(source.operationalPain),
    behaviorChange: text(source.behaviorChange),
    learningEvidence: text(source.learningEvidence),
    slides
  };
}

function menuIcon(type) {
  return {
    cover: 'fa-house',
    cards: 'fa-layer-group',
    checklist: 'fa-list-check',
    flow: 'fa-diagram-project',
    'chart-bar': 'fa-chart-column',
    'chart-line': 'fa-chart-line',
    'chart-pie': 'fa-chart-pie',
    'chart-funnel': 'fa-filter',
    'decision-tree': 'fa-code-branch',
    'metric-donut': 'fa-chart-pie',
    'kpi-row': 'fa-gauge-high',
    'infographic-timeline': 'fa-timeline',
    'radial-steps': 'fa-circle-nodes',
    'process-map': 'fa-diagram-project',
    'icon-columns': 'fa-icons',
    'pricing-table': 'fa-tags',
    'objective-board': 'fa-bullseye',
    'performance-summary': 'fa-chart-simple',
    table: 'fa-table',
    closing: 'fa-award'
  }[type] || 'fa-circle';
}

/** Corta o texto cru e escapa depois: escapar antes cortava entidades no meio
 *  ("&amp;" virava "&am") e o menu renderizava lixo. */
function truncated(value, size) {
  const raw = String(value ?? '');
  return esc(raw.length > size ? `${raw.slice(0, size - 1).trimEnd()}…` : raw);
}

/**
 * Primeira parte do titulo em branco, o resto em gradiente. O replace global
 * anterior abria um <span> por ocorrencia de " - " e fechava um so, deixando
 * markup desbalanceado em titulos com dois ou mais hifens.
 */
function coverTitleHtml(title) {
  const parts = String(title ?? '').split(/\s+-\s+/);
  const head = esc(parts.shift() ?? '');
  if (!parts.length) return head;
  return `${head}<br><span class="gradient-title">${esc(parts.join(' - '))}</span>`;
}

function slideNotesAttr(slide) {
  const notes = text(slide.lead || slide.subtitle || slide.title);
  return notes ? ` data-notes="${esc(notes)}"` : '';
}

function chartMax(chart) {
  const values = chart.series.flatMap((serie) => serie.values).map(Math.abs);
  return Math.max(1, ...values);
}

function chartUnit(chart) {
  return chart.unit ? ` ${esc(chart.unit)}` : '';
}

function renderChartLegend(chart) {
  return `<div class="chart-legend">${chart.series.map((serie) => `<span><i style="background:${esc(serie.color)}"></i>${esc(serie.name)}</span>`).join('')}</div>`;
}

function renderBarChart(slide) {
  const chart = slide.chart;
  const labels = chart.labels.slice(0, 8);
  return `<div class="chart-panel chart-bars" role="img" aria-label="${esc(slide.title)}">
${renderChartLegend(chart)}
<div class="bar-groups">${labels.map((label, labelIndex) => `<div class="bar-group"><div class="bars">${chart.series.map((serie) => {
    const value = Number(serie.values[labelIndex] || 0);
    const groupMax = Math.max(1, ...chart.series.map((item) => Math.abs(Number(item.values[labelIndex] || 0))));
    const height = Math.max(5, Math.round((Math.abs(value) / groupMax) * 100));
    return `<div class="bar-wrap"><div class="bar-value">${esc(value)}${chartUnit(chart)}</div><div class="bar" style="height:${height}%;background:${esc(serie.color)}"></div></div>`;
  }).join('')}</div><div class="bar-label">${esc(label)}</div></div>`).join('')}</div>
</div>`;
}

function renderLineChart(slide) {
  const chart = slide.chart;
  const labels = chart.labels.slice(0, 10);
  const values = chart.series.flatMap((serie) => serie.values.slice(0, labels.length)).map(Number).filter(Number.isFinite);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max(1, (maxValue - minValue) * 0.15);
  const min = Number.isFinite(minValue) ? Math.max(0, minValue - padding) : 0;
  const max = Number.isFinite(maxValue) ? maxValue + padding : chartMax(chart);
  const span = Math.max(1, max - min);
  const width = 760;
  const height = 300;
  const left = 46;
  const top = 24;
  const plotWidth = width - 82;
  const plotHeight = height - 70;
  const step = labels.length > 1 ? plotWidth / (labels.length - 1) : plotWidth;
  const pointsFor = (serie) => labels.map((_, index) => {
    const x = left + index * step;
    const y = top + plotHeight - (((Number(serie.values[index] || 0) - min) / span) * plotHeight);
    return [Math.round(x), Math.round(y)];
  });
  return `<div class="chart-panel" role="img" aria-label="${esc(slide.title)}">
${renderChartLegend(chart)}
<svg class="line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
<g class="grid">${[0, 1, 2, 3].map((tick) => `<line x1="${left}" y1="${top + tick * (plotHeight / 3)}" x2="${left + plotWidth}" y2="${top + tick * (plotHeight / 3)}"></line>`).join('')}</g>
${chart.series.map((serie) => {
    const points = pointsFor(serie);
    return `<polyline points="${points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="${esc(serie.color)}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></polyline>${points.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="6" fill="${esc(serie.color)}"></circle><text x="${x}" y="${Math.max(16, y - 12)}">${esc(serie.values[index])}${chartUnit(chart)}</text>`).join('')}`;
  }).join('')}
${labels.map((label, index) => `<text class="axis-label" x="${left + index * step}" y="${height - 18}">${esc(label)}</text>`).join('')}
</svg>
</div>`;
}

function piePath(cx, cy, radius, startAngle, endAngle) {
  const start = {
    x: cx + radius * Math.cos(startAngle),
    y: cy + radius * Math.sin(startAngle)
  };
  const end = {
    x: cx + radius * Math.cos(endAngle),
    y: cy + radius * Math.sin(endAngle)
  };
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function renderPieChart(slide) {
  const chart = slide.chart;
  const serie = chart.series[0] || { values: [], color: chartColors[0], name: 'Valor' };
  const values = serie.values.slice(0, chart.labels.length);
  const total = values.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0) || 1;
  let cursor = -Math.PI / 2;
  return `<div class="chart-panel pie-layout" role="img" aria-label="${esc(slide.title)}">
<svg class="pie-chart" viewBox="0 0 320 320">${values.map((value, index) => {
    const slice = (Math.max(0, value) / total) * Math.PI * 2;
    const path = piePath(160, 160, 130, cursor, cursor + slice);
    cursor += slice;
    return `<path d="${path}" fill="${safeColor('', index)}"></path>`;
  }).join('')}<circle cx="160" cy="160" r="72" class="pie-hole"></circle><text x="160" y="156" class="pie-total">${esc(total)}</text><text x="160" y="184" class="pie-sub">total</text></svg>
<div class="pie-list">${chart.labels.map((label, index) => {
    const value = values[index] || 0;
    const percent = Math.round((Math.max(0, value) / total) * 100);
    return `<div><span><i style="background:${safeColor('', index)}"></i>${esc(label)}</span><b>${esc(value)}${chartUnit(chart)} · ${percent}%</b></div>`;
  }).join('')}</div>
</div>`;
}

function renderFunnelChart(slide) {
  const chart = slide.chart;
  const serie = chart.series[0] || { values: [] };
  const values = serie.values.slice(0, chart.labels.length);
  const max = Math.max(1, ...values.map((value) => Math.abs(Number(value || 0))));
  return `<div class="chart-panel funnel-chart" role="img" aria-label="${esc(slide.title)}">
${chart.labels.map((label, index) => {
    const value = Number(values[index] || 0);
    const width = Math.max(28, Math.round((Math.abs(value) / max) * 100));
    return `<div class="funnel-step" style="width:${width}%;background:${safeColor('', index)}"><span>${esc(label)}</span><b>${esc(value)}${chartUnit(chart)}</b></div>`;
  }).join('')}
</div>`;
}

function renderDecisionTree(slide) {
  const items = slide.items.length ? slide.items : [
    { title: 'Condição', text: 'O indicador está fora da meta?' },
    { title: 'Ação A', text: 'Investigar causa e acionar correção.' },
    { title: 'Ação B', text: 'Manter monitoramento e registrar evidência.' }
  ];
  const [root, ...branches] = items;
  return `<div class="decision-tree" role="img" aria-label="${esc(slide.title)}">
<div class="tree-node root"><i class="fas ${esc(root.icon || 'fa-question')}"></i><h3>${esc(root.title)}</h3><p>${esc(root.text)}</p></div>
<div class="tree-branches">${branches.slice(0, 4).map((item, index) => `<div class="tree-branch"><div class="tree-line"></div><div class="tree-node"><i class="fas ${esc(item.icon || (index % 2 ? 'fa-arrow-right' : 'fa-check'))}"></i><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div></div>`).join('')}</div>
</div>`;
}

function renderVisualChart(slide) {
  if (slide.type === 'chart-line') return renderLineChart(slide);
  if (slide.type === 'chart-pie') return renderPieChart(slide);
  if (slide.type === 'chart-funnel') return renderFunnelChart(slide);
  if (slide.type === 'decision-tree') return renderDecisionTree(slide);
  return renderBarChart(slide);
}

function itemPercent(item, fallback = 75) {
  const match = `${item.title || ''} ${item.text || ''}`.match(/(\d+(?:[,.]\d+)?)\s*%/);
  const value = match ? Number(match[1].replace(',', '.')) : fallback;
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : fallback));
}

function firstMetricText(item) {
  const match = `${item.title || ''} ${item.text || ''}`.match(/(?:R\$\s*)?\d+(?:[,.]\d+)?\s*%?|R\$\s*\d+(?:[,.]\d+)?/i);
  return match ? match[0] : item.title;
}

function visualItems(slide, fallback = []) {
  return slide.items.length ? slide.items : fallback;
}

function splitFeatureText(value) {
  return text(value).split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
}

function renderMetricDonut(slide) {
  const items = visualItems(slide, [
    { icon: 'fa-face-smile', title: 'Satisfação', text: '67%' },
    { icon: 'fa-arrow-trend-up', title: 'Performance', text: '90%' },
    { icon: 'fa-user-check', title: 'Retenção', text: '19%' }
  ]).slice(0, 4);
  return `<div class="metric-donut-grid">${items.map((item, index) => {
    const value = itemPercent(item, [67, 90, 19, 75][index] || 75);
    return `<div class="metric-donut-card"><div class="metric-donut-ring" style="--value:${value};--ring:${safeColor('', index)}"><div><strong>${esc(firstMetricText(item))}</strong><span>${esc(item.title)}</span></div></div><p>${esc(item.text)}</p></div>`;
  }).join('')}</div>`;
}

function renderKpiRow(slide) {
  const items = visualItems(slide, [
    { icon: 'fa-building-user', title: 'Avaliações realizadas', text: '105' },
    { icon: 'fa-gauge-high', title: 'Excelente', text: '32%' },
    { icon: 'fa-chart-column', title: 'Satisfatório', text: '48%' }
  ]).slice(0, 4);
  return `<div class="kpi-row-visual">${items.map((item, index) => `<div class="kpi-tile"><i class="fas ${esc(item.icon || 'fa-chart-line')}"></i><div><strong>${esc(firstMetricText(item))}</strong><span>${esc(item.title)}</span><p>${esc(item.text)}</p></div><b style="background:${safeColor('', index)}"></b></div>`).join('')}</div>`;
}

function renderTimelinePattern(slide) {
  const items = visualItems(slide, [
    { icon: 'fa-1', title: 'Diagnóstico', text: 'Mapear cenário.' },
    { icon: 'fa-2', title: 'Execução', text: 'Aplicar rotina.' },
    { icon: 'fa-3', title: 'Medição', text: 'Validar resultado.' }
  ]).slice(0, 6);
  return `<div class="infographic-timeline">${items.map((item, index) => `<div class="timeline-point"><div class="timeline-dot"><i class="fas ${esc(item.icon || 'fa-circle')}"></i></div><div class="timeline-year">${String(index + 1).padStart(2, '0')}</div><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div>`).join('')}</div>`;
}

function renderRadialSteps(slide) {
  const items = visualItems(slide, [
    { icon: 'fa-magnifying-glass-chart', title: 'Ler', text: 'Entender o indicador.' },
    { icon: 'fa-comments', title: 'Orientar', text: 'Direcionar a execução.' },
    { icon: 'fa-list-check', title: 'Medir', text: 'Acompanhar evidência.' },
    { icon: 'fa-arrow-trend-up', title: 'Ajustar', text: 'Corrigir a rota.' }
  ]).slice(0, 6);
  return `<div class="radial-steps"><div class="radial-center"><strong>${esc(String(items.length).padStart(2, '0'))}</strong><span>etapas</span></div><div class="radial-list">${items.map((item, index) => `<div class="radial-card"><i class="fas ${esc(item.icon || 'fa-circle-check')}" style="color:${safeColor('', index)}"></i><div><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div></div>`).join('')}</div></div>`;
}

function renderProcessMap(slide) {
  const items = visualItems(slide, [
    { icon: 'fa-clipboard-list', title: 'Entrada', text: 'Receber demanda.' },
    { icon: 'fa-gears', title: 'Processo', text: 'Executar regra.' },
    { icon: 'fa-flag-checkered', title: 'Saída', text: 'Registrar evidência.' }
  ]).slice(0, 5);
  return `<div class="process-map-visual">${items.map((item, index) => `<div class="process-node"><div class="process-icon"><i class="fas ${esc(item.icon || 'fa-circle-check')}"></i></div><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div>${index < items.length - 1 ? '<div class="process-arrow"><i class="fas fa-arrow-right"></i></div>' : ''}`).join('')}</div>`;
}

function renderIconColumns(slide) {
  const items = visualItems(slide, [
    { icon: 'fa-bullseye', title: 'Missão', text: 'Entregar soluções eficientes.' },
    { icon: 'fa-eye', title: 'Visão', text: 'Ser referência operacional.' },
    { icon: 'fa-gem', title: 'Valores', text: 'Ética, inovação e foco no cliente.' }
  ]).slice(0, 4);
  return `<div class="icon-columns-visual">${items.map((item) => `<div class="icon-column"><i class="fas ${esc(item.icon || 'fa-circle-check')}"></i><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div>`).join('')}</div>`;
}

function renderPricingTable(slide) {
  const items = visualItems(slide, [
    { title: 'Plano Básico', text: 'R$ 500,00; Consultoria inicial; Relatório de resultados' },
    { title: 'Plano Médio', text: 'R$ 700,00; Planejamento estratégico; Suporte por e-mail' },
    { title: 'Plano Premium', text: 'R$ 900,00; Relatórios avançados; Suporte prioritário' }
  ]).slice(0, 4);
  return `<div class="pricing-grid">${items.map((item, index) => {
    const features = splitFeatureText(item.text);
    const price = features.shift() || firstMetricText(item);
    return `<div class="pricing-card"><div class="pricing-head" style="background:${safeColor('', index)}">${esc(item.title)}</div><strong>${esc(price)}</strong><ul>${features.map((feature) => `<li><i class="fas fa-circle-check"></i>${esc(feature)}</li>`).join('')}</ul></div>`;
  }).join('')}</div>`;
}

function renderObjectiveBoard(slide) {
  const items = visualItems(slide, [
    { title: 'Expandir presença no mercado', text: '' },
    { title: 'Aumentar satisfação dos clientes', text: '' },
    { title: 'Otimizar processos', text: '' }
  ]).slice(0, 5);
  return `<div class="objective-board"><div class="objective-target"><i class="fas fa-bullseye"></i></div><div class="objective-list">${items.map((item) => `<div class="objective-item"><i class="fas ${esc(item.icon || 'fa-circle-check')}"></i><span>${esc(item.title)}${item.text ? `<small>${esc(item.text)}</small>` : ''}</span></div>`).join('')}</div></div>`;
}

function renderPerformanceSummary(slide) {
  return `<div class="performance-summary">${renderKpiRow(slide)}${renderMetricDonut(slide)}</div>`;
}

function renderVisualPattern(slide) {
  if (slide.type === 'metric-donut') return renderMetricDonut(slide);
  if (slide.type === 'kpi-row') return renderKpiRow(slide);
  if (slide.type === 'infographic-timeline') return renderTimelinePattern(slide);
  if (slide.type === 'radial-steps') return renderRadialSteps(slide);
  if (slide.type === 'process-map') return renderProcessMap(slide);
  if (slide.type === 'icon-columns') return renderIconColumns(slide);
  if (slide.type === 'pricing-table') return renderPricingTable(slide);
  if (slide.type === 'objective-board') return renderObjectiveBoard(slide);
  if (slide.type === 'performance-summary') return renderPerformanceSummary(slide);
  return renderKpiRow(slide);
}

function renderSlide(slide, index) {
  if (slide.type === 'cover') {
    return `<section class="slide${index === 0 ? ' active' : ''}"${slideNotesAttr(slide)}>
<div class="capa-layout">
<div class="capa-eyebrow">Universidade Corporativa &bull; ${esc(slide.subtitle || 'Treinamento')}</div>
<h1 class="capa-title">${coverTitleHtml(slide.title)}</h1>
<p class="capa-subtitle">${esc(slide.subtitle)}</p>
<div class="capa-divider"></div>
</div>
</section>`;
  }
  if (slide.type === 'checklist') {
    return `<section class="slide"${slideNotesAttr(slide)}>
<div class="badge"><i class="fas ${menuIcon(slide.type)}"></i> ${String(index).padStart(2, '0')}</div>
<h2>${esc(slide.title)}</h2>
${slide.lead ? `<p class="lead">${esc(slide.lead)}</p>` : ''}
<div class="big-check">${slide.items.map((item) => `<div class="big-check-item"><i class="fas fa-circle-check"></i><span>${esc(item.title)}${item.text ? ` - ${esc(item.text)}` : ''}</span></div>`).join('')}</div>
</section>`;
  }
  if (slide.type === 'flow') {
    return `<section class="slide"${slideNotesAttr(slide)}>
<div class="badge"><i class="fas ${menuIcon(slide.type)}"></i> Processo</div>
<h2>${esc(slide.title)}</h2>
${slide.lead ? `<p class="lead">${esc(slide.lead)}</p>` : ''}
<div class="flow-steps">${slide.items.map((item, i) => `<div class="flow-step"><div class="step-num">${String(i + 1).padStart(2, '0')}</div><div class="step-icon"><i class="fas ${esc(item.icon)}"></i></div><div class="step-label">${esc(item.title)}</div></div>${i < slide.items.length - 1 ? '<div class="flow-arrow"><i class="fas fa-arrow-right"></i></div>' : ''}`).join('')}</div>
</section>`;
  }
  if (slide.type === 'table') {
    return `<section class="slide"${slideNotesAttr(slide)}>
<div class="badge"><i class="fas ${menuIcon(slide.type)}"></i> Referência</div>
<h2>${esc(slide.title)}</h2>
<table class="simple-table"><tbody>${slide.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>
</section>`;
  }
  if (slide.type.startsWith('chart-') || slide.type === 'decision-tree') {
    return `<section class="slide"${slideNotesAttr(slide)}>
<div class="badge"><i class="fas ${menuIcon(slide.type)}"></i> Visual</div>
<h2>${esc(slide.title)}</h2>
${slide.lead ? `<p class="lead">${esc(slide.lead)}</p>` : ''}
${renderVisualChart(slide)}
</section>`;
  }
  if (visualPatternTypes.includes(slide.type)) {
    return `<section class="slide"${slideNotesAttr(slide)}>
<div class="badge"><i class="fas ${menuIcon(slide.type)}"></i> Infográfico</div>
<h2>${esc(slide.title)}</h2>
${slide.lead ? `<p class="lead">${esc(slide.lead)}</p>` : ''}
${renderVisualPattern(slide)}
</section>`;
  }
  if (slide.type === 'closing') {
    return `<section class="slide"${slideNotesAttr(slide)}>
<div class="badge"><i class="fas fa-award"></i> Encerramento</div>
<div class="capa-layout">
<div class="capa-eyebrow">Treinamento Concluído</div>
<h2 style="font-family:'Orbitron',sans-serif;font-size:clamp(26px,4vw,58px);text-align:center;">${esc(slide.title)}</h2>
<p class="capa-subtitle">${esc(slide.subtitle || slide.lead || 'Obrigado pela participação.')}</p>
<div class="capa-divider"></div>
</div>
</section>`;
  }
  return `<section class="slide"${slideNotesAttr(slide)}>
<div class="badge"><i class="fas ${menuIcon(slide.type)}"></i> Conteúdo</div>
<h2>${esc(slide.title)}</h2>
${slide.lead ? `<p class="lead">${esc(slide.lead)}</p>` : ''}
<div class="grid-3">${slide.items.map((item) => `<div class="card"><i class="fas ${esc(item.icon)}"></i><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div>`).join('')}</div>
</section>`;
}

function renderDeck(plan) {
  const total = plan.slides.length;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>3F Contact Center • ${esc(plan.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&family=Orbitron:wght@500;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<script>window.TRAINING_CONFIG={assets:{logo3f:'../../_assets/logos/Logo_horizontal_branca.png',logo3fLight:'../../_assets/logos/Logo_horizontal_Azul.png',logo3fVertical:'../../_assets/logos/Logo_vertical_branca.png',logo3fVerticalLight:'../../_assets/logos/Logo_vertical_azul.png'}};</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}:root{--primary:#003467;--secondary:#003D38;--accent:#F0C55A;--light:#5E88C1;--dark:#04101d;--card:rgba(8,20,40,.72);--border:rgba(94,136,193,.22)}body{font-family:'Montserrat',sans-serif;background:#020B16;color:white;overflow:hidden;height:100vh}body:before{content:'';position:fixed;inset:0;background:radial-gradient(circle at top right,rgba(94,136,193,.18),transparent 35%),radial-gradient(circle at bottom left,rgba(240,197,90,.08),transparent 25%),linear-gradient(135deg,#010B15,#021325,#00152A);z-index:-2}body:after{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px);background-size:28px 28px;opacity:.35;z-index:-1}.sidebar{position:fixed;left:0;top:0;width:260px;height:100vh;background:rgba(0,0,0,.28);backdrop-filter:blur(18px);border-right:1px solid rgba(255,255,255,.06);padding:28px 20px;z-index:100;overflow-y:auto;transition:width .28s ease,padding .28s ease}.sidebar-collapse-btn{width:34px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:var(--accent);cursor:pointer;display:grid;place-items:center;transition:.25s}.sidebar-collapse-btn:hover{background:rgba(240,197,90,.12);border-color:rgba(240,197,90,.3)}.logo{margin-bottom:25px}.logo img{width:180px;object-fit:contain;transition:width .28s ease}.logo .logo-compact{display:none}.training-title{font-family:'Orbitron',sans-serif;font-size:24px;font-weight:800;line-height:1.2;color:var(--accent);margin-bottom:10px;text-transform:uppercase}.training-subtitle{font-size:13px;line-height:1.6;color:#C4D7F3;margin-bottom:26px}.menu-title{font-size:12px;letter-spacing:0;text-transform:uppercase;color:#7F9BC0;margin-bottom:14px}.menu{display:flex;flex-direction:column;gap:9px}.menu-item{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:14px;background:rgba(255,255,255,.02);border:1px solid transparent;cursor:pointer;transition:.35s}.menu-item:hover,.menu-item.active{background:rgba(94,136,193,.12);border-color:rgba(94,136,193,.25);transform:translateX(4px)}.menu-item i{width:20px;text-align:center;color:var(--accent)}.menu-item strong{display:block;font-size:14px;font-weight:600}.menu-item span{font-size:11px;color:#B4C7E7}.progress-card{margin-top:24px;padding:18px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}.progress-card h4{font-size:12px;margin-bottom:12px;color:#B4C7E7}.progress-bar,.top-progress .bar{height:8px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden}.progress-fill,.bar-fill{height:100%;width:0;background:linear-gradient(90deg,var(--accent),#FFE082);transition:.4s}.progress-info{margin-top:10px;display:flex;justify-content:space-between;font-size:12px}.main{margin-left:260px;height:100vh;position:relative;overflow:hidden;transition:margin-left .28s ease}.topbar{position:fixed;left:260px;right:0;top:0;height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:rgba(0,0,0,.15);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.05);z-index:99;transition:left .28s ease}.top-progress{width:50%}.top-progress-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}.top-progress span{font-size:12px;color:#C8D8F2;display:block;margin-bottom:10px}.top-progress-head span{margin-bottom:0}.top-actions{display:flex;justify-content:flex-end;gap:10px}.action-btn{padding:8px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:white;text-decoration:none;cursor:pointer;font-size:13px;line-height:1;white-space:nowrap;display:flex;align-items:center;justify-content:center;gap:8px}.action-btn:hover{background:rgba(240,197,90,.12);border-color:rgba(240,197,90,.2)}body.sidebar-collapsed .sidebar{width:84px;padding:28px 12px;overflow:hidden}body.sidebar-collapsed .sidebar-collapse-btn i{transform:rotate(180deg)}body.sidebar-collapsed .logo{margin-top:0;margin-bottom:24px;width:100%;display:flex;align-items:center;justify-content:center}body.sidebar-collapsed .logo .logo-wide{display:none}body.sidebar-collapsed .logo .logo-compact{display:block;width:56px;max-width:56px;height:auto;margin:0 auto;object-fit:contain;object-position:center}body.sidebar-collapsed .training-title,body.sidebar-collapsed .training-subtitle,body.sidebar-collapsed .menu-title,body.sidebar-collapsed .progress-card,body.sidebar-collapsed .menu-item strong,body.sidebar-collapsed .menu-item span{display:none}body.sidebar-collapsed .menu{align-items:center;width:100%}body.sidebar-collapsed .menu-item{width:46px;height:46px;display:grid;place-items:center;gap:0;padding:0;border-radius:14px;margin:0 auto}body.sidebar-collapsed .menu-item i{width:22px;height:22px;min-width:0;margin:0;display:grid;place-items:center;font-size:16px;line-height:1;text-align:center;transform:none}body.sidebar-collapsed .menu-item i:before{display:grid;width:22px;height:22px;place-items:center;text-align:center;line-height:1}body.sidebar-collapsed .menu-item:hover,body.sidebar-collapsed .menu-item.active{transform:none}body.sidebar-collapsed .main{margin-left:84px}body.sidebar-collapsed .topbar,body.sidebar-collapsed .slide-footer{left:84px}.slides{height:100vh;position:relative}.slide{position:absolute;inset:0;padding:88px 48px 72px;overflow-y:auto;opacity:0;transform:translateX(40px);transition:.45s ease}.slide.active{opacity:1;transform:translateX(0);z-index:2}.badge{display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;background:rgba(94,136,193,.12);border:1px solid rgba(94,136,193,.28);color:#C4D7F3;font-size:14px;font-weight:600;margin-bottom:18px}.badge i{color:var(--accent)}h1,h2{font-family:'Orbitron',sans-serif;text-transform:uppercase;line-height:1.08;letter-spacing:0}h2{font-size:clamp(30px,4.2vw,64px);margin-bottom:22px}.gradient-title{background:linear-gradient(90deg,#fff,#F0C55A);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.lead{font-size:18px;line-height:1.7;color:#C4D7F3;max-width:900px;margin-bottom:26px}.capa-layout{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px}.capa-eyebrow{color:#C4D7F3;letter-spacing:0;text-transform:uppercase;font-size:14px}.capa-title{font-size:clamp(34px,6vw,76px)}.capa-subtitle{font-size:clamp(18px,2vw,28px);color:#C4D7F3}.capa-divider{width:120px;height:4px;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--light));margin:6px auto}.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{position:relative;padding:24px;border-radius:18px;background:var(--card);border:1px solid var(--border);overflow:hidden}.card:before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--accent),var(--light))}.card i{font-size:28px;color:var(--accent);margin-bottom:16px}.card h3{font-size:20px;margin-bottom:10px}.card p{font-size:15px;line-height:1.6;color:#C4D7F3}.big-check{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.big-check-item{display:flex;align-items:center;gap:14px;padding:20px;border-radius:18px;background:var(--card);border:1px solid var(--border);font-size:18px}.big-check-item i{color:#74FF9F}.flow-steps{display:flex;align-items:stretch;gap:14px;flex-wrap:wrap}.flow-step{flex:1;min-width:160px;padding:20px;border-radius:18px;background:var(--card);border:1px solid var(--border);text-align:center}.step-num{font-family:'Orbitron';color:var(--accent);font-size:13px}.step-icon{font-size:26px;color:var(--accent);margin:12px}.step-label{font-weight:700}.flow-arrow{display:flex;align-items:center;color:var(--accent)}.simple-table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:18px;overflow:hidden}.simple-table td{padding:16px;border-bottom:1px solid var(--border);font-size:15px}.slide-footer{position:fixed;left:260px;right:0;bottom:0;height:60px;display:flex;align-items:center;justify-content:center;gap:30px;padding:0 55px;background:linear-gradient(to top,rgba(2,11,22,.95) 60%,transparent);z-index:90;pointer-events:none;transition:left .28s ease}.slide-footer:before,.slide-footer:after{content:'';height:1px;flex:1;background:linear-gradient(90deg,transparent,rgba(240,197,90,.3))}.slide-footer img{width:160px;opacity:.85}#drawCanvas{position:fixed;inset:0;z-index:85;pointer-events:none}@media(max-width:980px){.sidebar{left:-270px;transition:.3s}.sidebar.open{left:0}.main{margin-left:0}.topbar{left:0}.slide-footer{left:0;padding:0 24px}.grid-3,.big-check{grid-template-columns:1fr}.slide{padding:88px 22px 72px}.btn-label{display:none}body.sidebar-collapsed .sidebar{width:260px;padding:28px 20px}body.sidebar-collapsed .main{margin-left:0}body.sidebar-collapsed .topbar,body.sidebar-collapsed .slide-footer{left:0}body.sidebar-collapsed .logo{margin-top:0;margin-bottom:25px}body.sidebar-collapsed .logo img{width:180px}body.sidebar-collapsed .logo .logo-wide{display:block}body.sidebar-collapsed .logo .logo-compact{display:none}body.sidebar-collapsed .training-title,body.sidebar-collapsed .training-subtitle,body.sidebar-collapsed .menu-title,body.sidebar-collapsed .progress-card,body.sidebar-collapsed .menu-item strong,body.sidebar-collapsed .menu-item span{display:block}}
body.light-mode{background:#F4F7FB;color:#102033;}
body.light-mode:before{background:radial-gradient(circle at top right,rgba(94,136,193,.18),transparent 35%),radial-gradient(circle at bottom left,rgba(240,197,90,.14),transparent 25%),linear-gradient(135deg,#F8FAFE,#EAF0F8,#DDE8F5);}
body.light-mode:after{background-image:linear-gradient(rgba(0,52,103,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(0,52,103,.055) 1px,transparent 1px);opacity:.55;}
body.light-mode .sidebar,body.light-mode .topbar,body.light-mode .card,body.light-mode .progress-card,body.light-mode .menu-item,body.light-mode .action-btn,body.light-mode .simple-table,body.light-mode .big-check-item,body.light-mode .flow-step{background:rgba(255,255,255,.78);border-color:rgba(0,52,103,.16);box-shadow:0 18px 55px rgba(0,52,103,.08);}
body.light-mode .kpi-card,body.light-mode .message-box,body.light-mode .mission-values-box,body.light-mode .col-block,body.light-mode .tool-card,body.light-mode .comp-card,body.light-mode .level-card,body.light-mode .orbit-card,body.light-mode .timeline-item,body.light-mode .hub-node,body.light-mode .obj-item,body.light-mode .email-card,body.light-mode .group-item,body.light-mode .scale-track,body.light-mode .scale-seg,body.light-mode .print-frame,body.light-mode .print-body,body.light-mode .annot-item,body.light-mode .faq-item,body.light-mode .gallery-item,body.light-mode .final-msg-box{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(239,245,252,.92));border-color:rgba(0,52,103,.16);box-shadow:0 18px 45px rgba(0,52,103,.08);}
body.light-mode .simple-table td{background:rgba(255,255,255,.86);border-color:rgba(0,52,103,.14);}
body.light-mode .print-bar,body.light-mode .gallery-item .gbar{background:rgba(0,52,103,.06);border-color:rgba(0,52,103,.12);}
body.light-mode .print-body{color:#37506F;}
body.light-mode .scale-seg{border-color:rgba(0,52,103,.12);}
body.light-mode .kpi-card{background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(229,238,249,.94));border-color:rgba(0,52,103,.14);}
body.light-mode .kpi-card:hover,body.light-mode .tool-card:hover,body.light-mode .comp-card:hover,body.light-mode .level-card:hover{background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(220,233,248,.96));border-color:rgba(184,138,34,.28);}
body.light-mode .col-block.good{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(232,248,239,.92));border-color:rgba(38,148,88,.22);}
body.light-mode .col-block.bad{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(253,236,236,.92));border-color:rgba(196,78,78,.22);}
body.light-mode .col-block.good .col-block-title{color:#1F7A4B!important;}
body.light-mode .col-block.bad .col-block-title{color:#B44040!important;}
body.light-mode .kpi-section-title{background:rgba(255,255,255,.68);border-color:rgba(184,138,34,.18);color:#B88A22;}
body.light-mode .kpi-card .kpi-abbr{color:#003467!important;}
body.light-mode .kpi-card .kpi-name{color:#37506F!important;}
body.light-mode .training-subtitle,body.light-mode .top-progress span,body.light-mode .lead,body.light-mode .menu-item span,body.light-mode .progress-info,body.light-mode .card p,body.light-mode .simple-table td,body.light-mode .capa-subtitle{color:#37506F;}
body.light-mode .capa-eyebrow{color:#5E88C1!important;opacity:1;}
body.light-mode .capa-meta-item{color:#244567!important;background:rgba(255,255,255,.68);border-color:rgba(0,52,103,.14);box-shadow:0 10px 28px rgba(0,52,103,.07);}
body.light-mode .capa-meta-item i{color:#B88A22;}
body.light-mode .menu-title{color:#45617F;}
body.light-mode .slide,body.light-mode .menu-item strong,body.light-mode .card h3,body.light-mode h2{color:#102033;}
body.light-mode .menu-item:hover,body.light-mode .menu-item.active,body.light-mode .action-btn:hover{background:rgba(94,136,193,.13);border-color:rgba(0,52,103,.18);}
body.light-mode .badge{background:rgba(0,52,103,.07);border-color:rgba(0,52,103,.16);color:#244567;}
body.light-mode .slide-footer{background:linear-gradient(to top,rgba(244,247,251,.96) 60%,transparent);}
body.light-mode .slide-footer:before,body.light-mode .slide-footer:after{background:linear-gradient(90deg,transparent,rgba(0,52,103,.34));}
body.light-mode .sidebar-collapse-btn{background:rgba(0,52,103,.06);border-color:rgba(0,52,103,.14);}
body.light-mode .gradient-title{background:linear-gradient(90deg,#003467,#1F6EAA 58%,#B88A22);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
body.light-mode .slide p,body.light-mode .slide li,body.light-mode .slide span:not(.gradient-title),body.light-mode .slide strong,body.light-mode .slide h3,body.light-mode .value,body.light-mode .values-title,body.light-mode .message-box p,body.light-mode .mission-values-box p,body.light-mode .col-block li,body.light-mode .col-list-item,body.light-mode .tool-card p,body.light-mode .comp-card p,body.light-mode .level-card p,body.light-mode .orbit-card p,body.light-mode .timeline-item p,body.light-mode .obj-item span,body.light-mode .email-card p,body.light-mode .step-list-item span,body.light-mode .scale-poles,body.light-mode .print-body em{color:#244567!important;}
body.light-mode .slide h1,body.light-mode .slide h2,body.light-mode .capa-title,body.light-mode .message-box h3,body.light-mode .table-title,body.light-mode .simple-table td:first-child,body.light-mode .email-head h3,body.light-mode .print-body strong,body.light-mode .group-item strong,body.light-mode .col-block-title,body.light-mode .tool-card .tool-name,body.light-mode .comp-card h3,body.light-mode .level-card h3,body.light-mode .orbit-card h4,body.light-mode .timeline-item h3{color:#102033!important;}
body.light-mode .gradient-title{background:linear-gradient(90deg,#003467,#1F6EAA 58%,#B88A22)!important;-webkit-background-clip:text!important;-webkit-text-fill-color:transparent!important;}
body.light-mode .slide-counter,body.light-mode .training-title{color:#8A640C;}
body.light-mode .action-btn,body.light-mode .menu-toggle,body.light-mode .sidebar-collapse-btn,body.light-mode .nav-btn,body.light-mode .modal-close{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(235,242,250,.92));border-color:rgba(0,52,103,.22);color:#0E2F53;box-shadow:0 8px 22px rgba(0,52,103,.08);}
body.light-mode .action-btn i,body.light-mode .menu-toggle i,body.light-mode .sidebar-collapse-btn i,body.light-mode .nav-btn i,body.light-mode .modal-close i{color:#003467;}
body.light-mode .action-btn:hover,body.light-mode .menu-toggle:hover,body.light-mode .sidebar-collapse-btn:hover,body.light-mode .nav-btn:hover,body.light-mode .modal-close:hover{background:linear-gradient(180deg,rgba(231,240,252,.98),rgba(213,229,247,.95));border-color:rgba(0,52,103,.32);}
body.light-mode .theme-toggle{border-color:rgba(184,138,34,.35);}
body.light-mode .theme-toggle i{color:#B88A22;}
.theme-toggle{width:38px;min-width:38px;padding:0;aspect-ratio:1;border-radius:12px;}
.theme-toggle i{color:var(--accent);}
.chart-panel{width:min(980px,100%);margin-top:8px;padding:24px;border-radius:18px;background:var(--card);border:1px solid var(--border);box-shadow:0 22px 70px rgba(0,0,0,.2)}.chart-legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:18px}.chart-legend span{display:inline-flex;align-items:center;gap:8px;color:#C4D7F3;font-size:13px;font-weight:700}.chart-legend i,.pie-list i{display:inline-block;width:12px;height:12px;border-radius:999px}.bar-groups{height:360px;display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:18px;align-items:end}.bar-group{height:100%;display:grid;grid-template-rows:1fr auto;gap:10px}.bars{height:100%;display:flex;align-items:end;justify-content:center;gap:8px;border-bottom:1px solid rgba(255,255,255,.12)}.bar-wrap{height:100%;min-width:24px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:8px}.bar{width:100%;min-height:8px;border-radius:10px 10px 4px 4px;box-shadow:0 0 24px rgba(240,197,90,.18)}.bar-value{font-family:'Orbitron',sans-serif;font-size:11px;color:#E9F2FF;white-space:nowrap}.bar-label{text-align:center;font-size:12px;line-height:1.3;color:#C4D7F3;font-weight:700}.line-chart{width:100%;height:360px}.line-chart .grid line{stroke:rgba(255,255,255,.11);stroke-width:1}.line-chart text{fill:#DCE9FF;font-size:13px;font-weight:700;text-anchor:middle}.line-chart .axis-label{fill:#C4D7F3;font-size:12px}.pie-layout{display:grid;grid-template-columns:minmax(260px,360px) 1fr;gap:28px;align-items:center}.pie-chart{width:100%;max-width:360px;margin:auto}.pie-chart path{filter:drop-shadow(0 8px 18px rgba(0,0,0,.18))}.pie-hole{fill:rgba(2,11,22,.92);stroke:rgba(255,255,255,.08)}.pie-total{font-family:'Orbitron';font-size:34px;font-weight:900;fill:#fff;text-anchor:middle}.pie-sub{font-size:13px;fill:#C4D7F3;text-anchor:middle;text-transform:uppercase}.pie-list{display:grid;gap:12px}.pie-list div{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}.pie-list span{display:flex;align-items:center;gap:10px;color:#DCE9FF;font-weight:700}.pie-list b{font-family:'Orbitron';color:var(--accent)}.funnel-chart{display:flex;flex-direction:column;align-items:center;gap:10px}.funnel-step{min-width:220px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 24px;border-radius:12px;color:#06101D;box-shadow:0 14px 34px rgba(0,0,0,.18);font-weight:800}.funnel-step span{font-size:16px}.funnel-step b{font-family:'Orbitron';font-size:20px}.decision-tree{margin-top:8px;display:grid;gap:26px;justify-items:center}.tree-branches{width:100%;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:18px}.tree-branch{display:grid;gap:10px;justify-items:center}.tree-line{width:2px;height:28px;background:linear-gradient(var(--accent),rgba(94,136,193,.65))}.tree-node{width:100%;padding:20px;border-radius:18px;background:var(--card);border:1px solid var(--border);text-align:center}.tree-node.root{max-width:520px;border-color:rgba(240,197,90,.34);box-shadow:0 20px 70px rgba(240,197,90,.08)}.tree-node i{font-size:28px;color:var(--accent);margin-bottom:12px}.tree-node h3{font-size:18px;margin-bottom:8px}.tree-node p{font-size:14px;line-height:1.5;color:#C4D7F3}
.metric-donut-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:26px;width:min(980px,100%);margin-top:12px}.metric-donut-card{text-align:center;display:grid;gap:16px;justify-items:center}.metric-donut-ring{--value:75;--ring:var(--light);width:176px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--ring) calc(var(--value)*1%),rgba(196,215,243,.22) 0);box-shadow:0 22px 60px rgba(0,0,0,.2);position:relative}.metric-donut-ring:before{content:'';position:absolute;inset:18px;border-radius:50%;background:#071429;border:1px solid rgba(255,255,255,.08)}.metric-donut-ring div{position:relative;z-index:1;display:grid;gap:5px}.metric-donut-ring strong{font-family:'Orbitron';font-size:34px;color:#fff}.metric-donut-ring span{text-transform:uppercase;font-size:11px;color:#C4D7F3;font-weight:800}.metric-donut-card p{max-width:210px;color:#DCE9FF;line-height:1.5}.kpi-row-visual{width:min(1020px,100%);display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;margin-top:12px}.kpi-tile{position:relative;display:grid;grid-template-columns:54px 1fr 8px;gap:16px;align-items:center;padding:20px;border-radius:16px;background:var(--card);border:1px solid var(--border);box-shadow:0 18px 50px rgba(0,0,0,.15)}.kpi-tile>i{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:rgba(94,136,193,.18);color:var(--accent);font-size:24px}.kpi-tile strong{font-family:'Orbitron';font-size:30px;color:#fff;display:block}.kpi-tile span{display:block;color:#C4D7F3;font-weight:800}.kpi-tile p{font-size:13px;line-height:1.4;color:#C4D7F3}.kpi-tile b{width:8px;height:70%;border-radius:999px}.infographic-timeline{width:min(1040px,100%);display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;margin-top:28px;position:relative}.infographic-timeline:before{content:'';position:absolute;left:8%;right:8%;top:52px;height:3px;background:linear-gradient(90deg,var(--accent),var(--light),#FF8A5C);opacity:.7}.timeline-point{position:relative;text-align:center;padding:0 12px}.timeline-dot{width:104px;height:104px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#123C7A,#5E88C1);border:10px solid rgba(255,255,255,.14);box-shadow:0 18px 46px rgba(0,0,0,.22);position:relative;z-index:1}.timeline-dot i{font-size:26px;color:#fff}.timeline-year{font-family:'Orbitron';font-size:26px;color:rgba(196,215,243,.28);font-weight:900;margin-bottom:4px}.timeline-point h3{font-size:16px;color:#fff;margin-bottom:8px}.timeline-point p{font-size:13px;line-height:1.45;color:#C4D7F3}.radial-steps{width:min(1020px,100%);display:grid;grid-template-columns:260px 1fr;gap:30px;align-items:center;margin-top:10px}.radial-center{width:230px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;align-content:center;background:radial-gradient(circle at center,#071429 52%,transparent 53%),conic-gradient(var(--accent) 0 24%,var(--light) 24% 58%,#FF8A5C 58% 78%,rgba(196,215,243,.5) 78%);box-shadow:0 20px 60px rgba(0,0,0,.22)}.radial-center strong{font-family:'Orbitron';font-size:48px;color:#fff}.radial-center span{text-transform:uppercase;color:#C4D7F3;font-weight:800}.radial-list{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:14px}.radial-card{display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:16px;background:var(--card);border:1px solid var(--border)}.radial-card i{font-size:24px}.radial-card h3{font-size:17px;color:#fff}.radial-card p{font-size:13px;line-height:1.45;color:#C4D7F3}.process-map-visual{width:min(1040px,100%);display:flex;align-items:stretch;gap:12px;flex-wrap:wrap;margin-top:18px}.process-node{flex:1;min-width:150px;padding:20px;border-radius:16px;background:var(--card);border:1px solid var(--border);text-align:center}.process-icon{width:58px;height:58px;border-radius:16px;margin:0 auto 14px;display:grid;place-items:center;background:linear-gradient(135deg,var(--light),#173B73);color:#fff}.process-node h3{font-size:17px;color:#fff;margin-bottom:8px}.process-node p{font-size:13px;line-height:1.45;color:#C4D7F3}.process-arrow{display:grid;place-items:center;color:var(--accent);font-size:22px}.icon-columns-visual{width:min(980px,100%);display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:28px;margin-top:18px}.icon-column{text-align:center;padding:12px 24px;border-right:1px solid rgba(196,215,243,.25)}.icon-column:last-child{border-right:0}.icon-column i{font-size:68px;color:var(--light);margin-bottom:18px}.icon-column h3{font-size:22px;color:#fff;text-transform:uppercase;margin-bottom:12px}.icon-column p{font-size:17px;line-height:1.55;color:#DCE9FF}.pricing-grid{width:min(980px,100%);display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:22px;margin-top:12px}.pricing-card{overflow:hidden;border-radius:16px;background:var(--card);border:1px solid var(--border);box-shadow:0 20px 56px rgba(0,0,0,.16)}.pricing-head{padding:12px 16px;text-align:center;color:#071429;font-weight:900;text-transform:uppercase}.pricing-card strong{display:block;font-family:'Orbitron';font-size:32px;color:#fff;text-align:center;padding:20px 18px 8px}.pricing-card ul{list-style:none;display:grid;gap:10px;padding:8px 22px 24px}.pricing-card li{display:flex;gap:9px;align-items:flex-start;color:#DCE9FF;font-size:14px;line-height:1.35}.pricing-card li i{color:#74FF9F;margin-top:2px}.objective-board{width:min(1020px,100%);display:grid;grid-template-columns:340px 1fr;gap:42px;align-items:center;margin-top:8px}.objective-target{aspect-ratio:1;display:grid;place-items:center}.objective-target i{font-size:230px;color:#5E88C1;filter:drop-shadow(0 24px 48px rgba(0,0,0,.22))}.objective-list{display:grid;gap:18px}.objective-item{display:grid;grid-template-columns:52px 1fr;gap:16px;align-items:center}.objective-item i{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:#1E4A94;color:#fff;font-size:24px}.objective-item span{font-size:28px;line-height:1.18;color:#E9F2FF;font-weight:600}.objective-item small{display:block;font-size:15px;line-height:1.45;color:#C4D7F3;margin-top:5px}.performance-summary{display:grid;gap:28px}
.slide-counter{font-family:'Orbitron',sans-serif;font-size:18px;font-weight:700;color:var(--accent);min-width:90px;text-align:right}.navigation{position:fixed;right:28px;bottom:22px;display:flex;gap:12px;z-index:150}.navigation>div{display:flex;flex-direction:column;align-items:center}.nav-btn{width:44px;height:44px;border-radius:50%;border:1px solid rgba(240,197,90,.28);background:rgba(0,0,0,.35);backdrop-filter:blur(12px);color:white;font-size:15px;cursor:pointer;transition:.3s}.nav-btn:hover{background:rgba(240,197,90,.18);transform:scale(1.08)}.nav-label{text-align:center;font-size:11px;margin-top:6px;color:#D0DDF2}.menu-toggle{display:none;width:42px;height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:white;font-size:17px;cursor:pointer;align-items:center;justify-content:center;flex-shrink:0;transition:.3s}.menu-toggle:hover{background:rgba(240,197,90,.12);border-color:rgba(240,197,90,.2)}.modal-overlay{position:fixed;inset:0;z-index:300;background:rgba(2,8,18,.72);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:24px}.modal-overlay.show{display:flex}.modal{position:relative;width:min(560px,92vw);background:linear-gradient(135deg,rgba(10,22,42,.98),rgba(4,14,28,.98));border:1px solid var(--border);border-radius:24px;padding:32px;box-shadow:0 30px 80px rgba(0,0,0,.6)}.modal h3{color:var(--accent);margin-bottom:20px;display:flex;align-items:center;gap:12px;font-size:20px}.modal-close{position:absolute;top:20px;right:24px;width:38px;height:38px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:#fff;font-size:16px;cursor:pointer;transition:.3s}.modal-close:hover{background:rgba(240,197,90,.12);border-color:rgba(240,197,90,.25)}.kbd-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)}.kbd-row:last-child{border-bottom:none}.kbd-row>span{font-size:15px;color:rgba(255,255,255,.85)}.kbd{display:inline-flex;gap:6px}.kbd b{font-family:'Orbitron',sans-serif;font-size:13px;font-weight:700;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;padding:6px 12px;color:var(--accent);min-width:34px;text-align:center}.instructor-panel{position:fixed;left:260px;right:0;bottom:0;z-index:80;background:linear-gradient(to top,rgba(2,10,20,.99),rgba(2,10,20,.95));border-top:1px solid rgba(240,197,90,.28);padding:18px 28px;display:none;grid-template-columns:1fr 300px;gap:24px;align-items:center;max-height:38vh}.instructor-panel{transition:left .28s ease}body.sidebar-collapsed .instructor-panel{left:84px}body.instructor .instructor-panel{display:grid}body.instructor .slide{padding-bottom:calc(38vh + 20px)}.ip-notes h4{font-family:'Orbitron',sans-serif;font-size:12px;letter-spacing:1px;color:var(--accent);margin-bottom:8px;text-transform:uppercase;display:flex;align-items:center;gap:8px}.ip-title{font-size:17px;font-weight:700;margin-bottom:6px}.ip-side{display:flex;flex-direction:column;gap:12px;border-left:1px solid rgba(255,255,255,.12);padding-left:20px}.ip-side .ip-lab{font-size:11px;color:#7F9BC0;letter-spacing:1px}.ip-timer{font-family:'Orbitron',sans-serif;font-size:30px;font-weight:800;color:var(--accent);line-height:1}.ip-nav{font-size:13px;color:rgba(255,255,255,.6)}.ip-nav b{color:#fff;font-weight:600}.ip-notes-edit{width:100%;min-height:64px;max-height:22vh;resize:vertical;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:10px 12px;color:#fff;font-family:'Montserrat',sans-serif;font-size:14px;line-height:1.5}.ip-notes-edit:focus{outline:none;border-color:rgba(240,197,90,.4)}.ip-saved{font-size:11px;color:#74FF9F;margin-top:4px;height:14px}
body.light-mode .modal{background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(239,245,252,.98));border-color:rgba(0,52,103,.16);box-shadow:0 30px 80px rgba(0,52,103,.18)}body.light-mode .modal h3{color:#8A640C}body.light-mode .kbd-row{border-color:rgba(0,52,103,.12)}body.light-mode .kbd-row>span,body.light-mode .ip-nav,body.light-mode .ip-nav b{color:#244567}body.light-mode .kbd b{background:rgba(0,52,103,.06);border-color:rgba(0,52,103,.16);color:#8A640C}body.light-mode .instructor-panel{background:linear-gradient(to top,rgba(244,247,251,.99),rgba(239,245,252,.95));border-color:rgba(0,52,103,.2)}body.light-mode .ip-notes-edit{background:rgba(255,255,255,.86);border-color:rgba(0,52,103,.18);color:#102033}body.light-mode .ip-side{border-color:rgba(0,52,103,.12)}
body.light-mode .chart-panel,body.light-mode .tree-node,body.light-mode .kpi-tile,body.light-mode .radial-card,body.light-mode .process-node,body.light-mode .pricing-card{background:rgba(255,255,255,.82);border-color:rgba(0,52,103,.16);box-shadow:0 18px 55px rgba(0,52,103,.08)}body.light-mode .chart-legend span,body.light-mode .bar-label,body.light-mode .tree-node p,body.light-mode .kpi-tile span,body.light-mode .kpi-tile p,body.light-mode .timeline-point p,body.light-mode .radial-card p,body.light-mode .process-node p,body.light-mode .pricing-card li,body.light-mode .objective-item small{color:#37506F!important}body.light-mode .bar-value,body.light-mode .pie-list span,body.light-mode .line-chart text{color:#102033;fill:#102033}body.light-mode .line-chart .grid line{stroke:rgba(0,52,103,.14)}body.light-mode .line-chart .axis-label,body.light-mode .pie-sub{fill:#37506F}body.light-mode .pie-hole{fill:#F4F7FB;stroke:rgba(0,52,103,.12)}body.light-mode .pie-total{fill:#102033}body.light-mode .pie-list div{background:rgba(0,52,103,.05);border-color:rgba(0,52,103,.12)}body.light-mode .metric-donut-ring:before{background:#F4F7FB;border-color:rgba(0,52,103,.12)}body.light-mode .metric-donut-ring strong,body.light-mode .kpi-tile strong,body.light-mode .timeline-point h3,body.light-mode .radial-card h3,body.light-mode .process-node h3,body.light-mode .icon-column h3,body.light-mode .pricing-card strong,body.light-mode .objective-item span{color:#102033!important}body.light-mode .metric-donut-ring span,body.light-mode .metric-donut-card p,body.light-mode .icon-column p{color:#37506F!important}body.light-mode .infographic-timeline:before{opacity:.9}body.light-mode .timeline-year{color:rgba(0,52,103,.18)}body.light-mode .icon-column{border-color:rgba(0,52,103,.16)}body.light-mode .objective-target i{color:#1E4A94}
@media(max-width:1200px){.top-actions{gap:6px}.action-btn{padding:8px 10px}.btn-label{display:none}.slide-counter{min-width:72px;font-size:15px}}
@media(max-width:980px){.menu-toggle{display:flex}.instructor-panel{left:0;grid-template-columns:1fr;max-height:52vh;overflow-y:auto}body.sidebar-collapsed .instructor-panel{left:0}body.instructor .slide{padding-bottom:calc(52vh + 20px)}.pie-layout{grid-template-columns:1fr}.bar-groups{height:300px}.line-chart{height:300px}.radial-steps,.objective-board{grid-template-columns:1fr}.radial-center{width:190px;margin:auto}.radial-list{grid-template-columns:1fr}.objective-target i{font-size:160px}.objective-item span{font-size:22px}.icon-column{border-right:0;border-bottom:1px solid rgba(196,215,243,.18)}.icon-column:last-child{border-bottom:0}.process-arrow{display:none}}
@media(max-width:640px){.navigation{right:14px;bottom:14px;gap:8px}.nav-btn{width:48px;height:48px;font-size:15px}.slide-counter{display:none}}
</style>
</head>
<body>
<div class="sidebar">
<div class="logo"><img class="logo-wide" data-asset="logo3f" alt="3F Contact Center"><img class="logo-compact" data-asset="logo3fVertical" alt="3F Contact Center"></div>
<div class="training-title">${esc(plan.title)}</div>
<div class="training-subtitle">${esc(plan.area)}<br>• Universidade Corporativa</div>
<div class="menu-title">Módulos</div>
<div class="menu">${plan.slides.map((slide, i) => `<div class="menu-item${i === 0 ? ' active' : ''}" data-slide-index="${i}"><i class="fas ${menuIcon(slide.type)}"></i><div><strong>${truncated(slide.title, 22)}</strong><span>Slide ${i + 1}</span></div></div>`).join('')}</div>
<div class="progress-card"><h4>PROGRESSO DO TREINAMENTO</h4><div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div><div class="progress-info"><span id="progressText">1 / ${total}</span><span style="color:#74FF9F;">Em andamento</span></div></div>
</div>
<div class="main">
<div class="topbar"><div class="top-progress"><div class="top-progress-head"><button class="sidebar-collapse-btn" type="button" onclick="toggleSidebar()" title="Recolher menu lateral" aria-label="Recolher menu lateral"><i class="fas fa-chevron-left"></i></button><span>PROGRESSO GERAL</span></div><div class="bar"><div class="bar-fill" id="topProgress"></div></div></div><div class="top-actions"><button class="menu-toggle" id="menuToggle" type="button" onclick="toggleSidebar()" title="Abrir menu" aria-label="Abrir menu"><i class="fas fa-bars"></i></button><a class="action-btn" href="/index.html"><i class="fas fa-house"></i><span class="btn-label">Catálogo</span></a><button class="action-btn" type="button" onclick="toggleShortcuts()"><i class="fas fa-keyboard"></i><span class="btn-label">Atalhos</span></button><button class="action-btn" type="button" onclick="toggleFullscreen()"><i class="fas fa-expand" id="fsIcon"></i><span class="btn-label">Tela Cheia</span></button><button class="action-btn" id="instructorBtn" type="button" onclick="toggleInstructor()"><i class="fas fa-user-tie"></i><span class="btn-label">Modo Instrutor</span></button><button class="action-btn" id="penBtn" type="button" onclick="togglePen()"><i class="fas fa-pen-nib"></i><span class="btn-label">Marcador</span></button><div class="slide-counter" id="slideCounter">01 / 00</div><button class="action-btn theme-toggle" type="button" onclick="toggleTheme()" title="Alternar tema" aria-label="Alternar tema"><i class="fas fa-sun"></i></button></div></div>
<div class="slides">${plan.slides.map(renderSlide).join('\n')}</div>
<div class="slide-footer"><img data-asset="logo3f" alt="3F Contact Center"></div>
<div class="navigation"><div><button class="nav-btn" type="button" onclick="prevSlide()" title="Slide anterior" aria-label="Slide anterior"><i class="fas fa-chevron-left"></i></button><div class="nav-label">ANTERIOR</div></div><div><button class="nav-btn" type="button" onclick="nextSlide()" title="Próximo slide" aria-label="Próximo slide"><i class="fas fa-chevron-right"></i></button><div class="nav-label">PRÓXIMO</div></div></div>
</div>
<div class="modal-overlay" id="shortcutsModal" onclick="if(event.target===this)toggleShortcuts()"><div class="modal"><button class="modal-close" type="button" onclick="toggleShortcuts()" aria-label="Fechar atalhos"><i class="fas fa-xmark"></i></button><h3><i class="fas fa-keyboard"></i> Atalhos de Teclado</h3><div class="kbd-row"><span>Próximo slide</span><span class="kbd"><b>→</b><b>Espaço</b></span></div><div class="kbd-row"><span>Slide anterior</span><span class="kbd"><b>←</b></span></div><div class="kbd-row"><span>Primeiro / último</span><span class="kbd"><b>Home</b><b>End</b></span></div><div class="kbd-row"><span>Tela cheia</span><span class="kbd"><b>F</b></span></div><div class="kbd-row"><span>Modo instrutor</span><span class="kbd"><b>P</b></span></div><div class="kbd-row"><span>Marcador</span><span class="kbd"><b>D</b></span></div><div class="kbd-row"><span>Limpar marcações</span><span class="kbd"><b>C</b></span></div><div class="kbd-row"><span>Abrir esta ajuda</span><span class="kbd"><b>?</b></span></div><div class="kbd-row"><span>Fechar / sair</span><span class="kbd"><b>Esc</b></span></div></div></div>
<div class="instructor-panel" id="instructorPanel"><div class="ip-notes"><h4><i class="fas fa-chalkboard-user"></i> Notas do Instrutor</h4><div class="ip-title" id="ipTitle">—</div><textarea id="ipNotes" class="ip-notes-edit" placeholder="Digite suas notas para este slide... (salva sozinho neste navegador)"></textarea><div class="ip-saved" id="ipSaved"></div></div><div class="ip-side"><div><div class="ip-lab">TEMPO</div><div class="ip-timer" id="ipTimer">00:00</div></div><div class="ip-nav">Próximo: <b id="ipNext">—</b></div></div></div>
<canvas id="drawCanvas"></canvas>
<script>
const slides=document.querySelectorAll('.slide');
const menuItems=document.querySelectorAll('.menu-item');
const progressFill=document.getElementById('progressFill');
const topProgress=document.getElementById('topProgress');
const progressText=document.getElementById('progressText');
const slideCounter=document.getElementById('slideCounter');
const shortcutsModal=document.getElementById('shortcutsModal');
const drawCanvas=document.getElementById('drawCanvas');
const drawCtx=drawCanvas.getContext('2d');
let current=0;
let penOn=false;
let drawing=false;
let ipTimerInt=null;
let ipStart=0;

function applyConfiguredAssets(mode=localStorage.getItem('3f-theme')||'dark'){
const light=mode==='light';
document.body.classList.toggle('light-mode',light);
document.querySelectorAll('[data-asset]').forEach((el)=>{
const key=el.dataset.asset;
const lightKey=key+'Light';
const asset=window.TRAINING_CONFIG.assets[light&&window.TRAINING_CONFIG.assets[lightKey]?lightKey:key];
if(!asset)return;
if(el.tagName==='IMG')el.src=asset;
else el.style.backgroundImage='url("'+asset+'")';
});
document.querySelectorAll('.theme-toggle').forEach((btn)=>{
btn.innerHTML=light?'<i class="fas fa-moon"></i>':'<i class="fas fa-sun"></i>';
btn.setAttribute('aria-label',light?'Ativar tema escuro':'Ativar tema claro');
btn.setAttribute('title',light?'Ativar tema escuro':'Ativar tema claro');
});
}
function setTheme(mode){localStorage.setItem('3f-theme',mode);applyConfiguredAssets(mode)}
function toggleTheme(){setTheme(document.body.classList.contains('light-mode')?'dark':'light')}
function toggleSidebar(){
if(window.innerWidth>980){document.body.classList.toggle('sidebar-collapsed');return}
document.querySelector('.sidebar').classList.toggle('open');
}
function closeSidebar(){document.querySelector('.sidebar').classList.remove('open')}
function pad(n){return String(n).padStart(2,'0')}
function slideTitle(sec){if(!sec)return '—';const h=sec.querySelector('.capa-title,h1,h2');return h?h.textContent.trim().replace(/\\s+/g,' '):'Slide'}
function noteKey(i){return 'dl-notes:'+document.title+':'+i}
function refreshInstructor(){
if(!document.body.classList.contains('instructor'))return;
const sec=slides[current];
document.getElementById('ipTitle').textContent=slideTitle(sec);
const ta=document.getElementById('ipNotes');
const saved=localStorage.getItem(noteKey(current));
ta.value=saved!=null?saved:(sec&&sec.dataset.notes?sec.dataset.notes:'');
document.getElementById('ipSaved').textContent='';
document.getElementById('ipNext').textContent=current<slides.length-1?slideTitle(slides[current+1]):'— fim —';
}
function updateSlides(){
slides.forEach((slide,index)=>slide.classList.toggle('active',index===current));
menuItems.forEach((item,index)=>item.classList.toggle('active',index===current));
const progress=((current+1)/slides.length)*100;
progressFill.style.width=progress+'%';
topProgress.style.width=progress+'%';
progressText.innerHTML=(current+1)+' / '+slides.length;
slideCounter.textContent=pad(current+1)+' / '+pad(slides.length);
const activeItem=menuItems[current];
if(activeItem)activeItem.scrollIntoView({block:'nearest'});
clearDraw();
refreshInstructor();
}
function nextSlide(){if(current<slides.length-1){current++;updateSlides()}}
function prevSlide(){if(current>0){current--;updateSlides()}}
function goSlide(index){current=Math.max(0,Math.min(slides.length-1,Number(index)||0));updateSlides();closeSidebar()}
menuItems.forEach((item,index)=>item.addEventListener('click',()=>goSlide(index)));
function toggleShortcuts(){shortcutsModal.classList.toggle('show')}
function toggleFullscreen(){
const d=document.documentElement;
if(!document.fullscreenElement)(d.requestFullscreen||function(){}).call(d);
else(document.exitFullscreen||function(){}).call(document);
}
function syncFsIcon(){const icon=document.getElementById('fsIcon');if(icon)icon.className=document.fullscreenElement?'fas fa-compress':'fas fa-expand'}
document.addEventListener('fullscreenchange',syncFsIcon);
function toggleInstructor(){
const on=document.body.classList.toggle('instructor');
const btn=document.getElementById('instructorBtn');
if(btn)btn.style.borderColor=on?'rgba(240,197,90,.45)':'';
if(on){ipStart=Date.now();tickTimer();ipTimerInt=setInterval(tickTimer,1000);refreshInstructor()}
else{clearInterval(ipTimerInt);ipTimerInt=null}
}
function tickTimer(){
const el=document.getElementById('ipTimer');
if(!el)return;
const seconds=Math.floor((Date.now()-ipStart)/1000);
el.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}
document.getElementById('ipNotes').addEventListener('input',function(){
localStorage.setItem(noteKey(current),this.value);
const saved=document.getElementById('ipSaved');
saved.textContent='salvo automaticamente';
clearTimeout(this._t);
this._t=setTimeout(()=>{saved.textContent=''},1200);
});
function resizeCanvas(){drawCanvas.width=window.innerWidth;drawCanvas.height=window.innerHeight;drawCtx.strokeStyle='#F0C55A';drawCtx.lineWidth=3;drawCtx.lineCap='round';drawCtx.lineJoin='round'}
function clearDraw(){drawCtx.clearRect(0,0,drawCanvas.width,drawCanvas.height)}
function togglePen(){
penOn=!penOn;
drawCanvas.style.pointerEvents=penOn?'auto':'none';
drawCanvas.style.cursor=penOn?'crosshair':'';
const btn=document.getElementById('penBtn');
if(btn)btn.style.borderColor=penOn?'rgba(240,197,90,.45)':'';
if(penOn)resizeCanvas();
}
drawCanvas.addEventListener('pointerdown',(event)=>{if(!penOn)return;drawing=true;drawCtx.beginPath();drawCtx.moveTo(event.clientX,event.clientY)});
drawCanvas.addEventListener('pointermove',(event)=>{if(!penOn||!drawing)return;drawCtx.lineTo(event.clientX,event.clientY);drawCtx.stroke()});
window.addEventListener('pointerup',()=>{drawing=false});
window.addEventListener('resize',()=>{if(penOn)resizeCanvas()});
window.addEventListener('keydown',(event)=>{
if(event.target.matches('input,textarea'))return;
const key=event.key.toLowerCase();
if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();nextSlide()}
if(event.key==='ArrowLeft')prevSlide();
if(event.key==='Home'){current=0;updateSlides()}
if(event.key==='End'){current=slides.length-1;updateSlides()}
if(key==='f')toggleFullscreen();
if(key==='p')toggleInstructor();
if(key==='d')togglePen();
if(key==='c')clearDraw();
if(event.key==='?'||(event.shiftKey&&event.key==='/'))toggleShortcuts();
if(event.key==='Escape'){shortcutsModal.classList.remove('show');if(penOn)togglePen()}
});
applyConfiguredAssets();
resizeCanvas();
updateSlides();
</script>
</body>
</html>`;
}

async function generateTraining(input) {
  const result = await llmPlan(input);
  const plan = result.plan;
  const areaSlug = slugify(plan.area);
  const areaDir = path.join(deckRoot, areaSlug);
  await mkdir(areaDir, { recursive: true });
  const { fileSlug, version } = await writeUniqueDeck(areaDir, plan.title, renderDeck(plan));
  const relFile = `decks/${areaSlug}/${fileSlug}`;
  await writeCatalog({
    title: plan.title,
    area: plan.area,
    version,
    file: relFile,
    status: 'Rascunho gerado',
    description: text(input?.objective) || plan.objective || plan.subtitle || '',
    generated: true
  });
  return { ...result, file: relFile, url: `/${relFile}`, plan };
}

function resolveDeckFile(file) {
  const clean = text(file).replace(/^\/+/, '');
  if (!clean || !clean.endsWith('.html')) throw new RequestError('Arquivo do treinamento invalido para revisão.');
  const filePath = path.resolve(trainingRoot, clean);
  const relativePath = path.relative(trainingRoot, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new RequestError('Caminho do treinamento fora da pasta permitida.');
  if (!relativePath.startsWith(`decks${path.sep}`)) throw new RequestError('A revisão só pode alterar arquivos em treinamentos/decks.');
  return { filePath, relFile: relativePath.split(path.sep).join('/') };
}

/**
 * A revisao sobrescreve o arquivo por inteiro. Decks autorais (feitos a mao a
 * partir do template) nao tem `generated: true` no catalogo e ficam protegidos.
 */
async function assertRevisableDeck(relFile) {
  const catalog = await readCatalog();
  const trainings = Array.isArray(catalog.trainings) ? catalog.trainings : [];
  const entry = trainings.find((item) => item.file === relFile);
  if (!entry) throw new RequestError('Treinamento nao encontrado no catálogo.', 404);
  if (entry.generated !== true) {
    throw new RequestError('Este treinamento não foi criado pelo gerador e não pode ser sobrescrito pela revisão.', 403);
  }
  return entry;
}

async function reviseTraining(input) {
  const instruction = text(input.instruction);
  if (!instruction) throw new RequestError('Informe o pedido de revisão.');
  const { filePath, relFile } = resolveDeckFile(input.file);
  const entry = await assertRevisableDeck(relFile);
  await stat(filePath);

  // A revisao sobrescreve o arquivo inteiro. Sem o plano atual no corpo, a LLM
  // recebia um plano vazio, inventava um treinamento do zero e o deck original era
  // perdido - o pedido era "revise isto", nao "gere outro por cima".
  const currentPlan = isPlainObject(input.plan) ? input.plan : {};
  if (!Array.isArray(currentPlan.slides) || !currentPlan.slides.length) {
    throw new RequestError(
      'Envie o plano atual do treinamento (campo "plan" com "slides") para revisar. Sem ele a revisão sobrescreveria o deck com conteúdo novo.',
      400
    );
  }

  const briefing = normalizeBriefing(input.briefing);
  const result = await llmRevisePlan({ instruction, plan: currentPlan, briefing });
  // A area fica travada na do catalogo: o arquivo nao e movido de pasta na
  // revisao, entao aceitar uma area nova deixaria o deck em decks/<area-antiga>/
  // com o catalogo apontando outra area.
  const plan = { ...result.plan, area: entry.area || result.plan.area };
  await writeFile(filePath, renderDeck(plan));
  await writeCatalog({
    ...entry,
    title: plan.title,
    area: plan.area,
    // Preserva a versao original do deck: gravar 'rev' apagava o v1/v2 e tornava
    // duas revisoes seguidas indistinguiveis no catalogo.
    version: entry.version || 'v1',
    file: relFile,
    status: 'Revisado',
    description: plan.objective || plan.subtitle || briefing.objective || '',
    generated: true
  });
  return {
    ...result,
    file: relFile,
    url: `/${relFile}`,
    plan,
    reply: `Treinamento atualizado com sucesso. A revisão foi aplicada no mesmo arquivo com ${plan.slides.length} slides.`
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    // Sem decode, arquivos com espaco (%20) nunca resolviam. O decode acontece
    // antes do resolve, e a checagem de path relativo abaixo continua barrando
    // qualquer travessia que apareca depois de decodificada.
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return json(res, 400, { error: 'Caminho invalido.' });
  }
  if (pathname.includes('\0')) return json(res, 400, { error: 'Caminho invalido.' });
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(publicDir, `.${pathname}`);
  const relativePath = path.relative(publicDir, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return json(res, 403, { error: 'Acesso negado.' });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not file');
    res.writeHead(200, {
      ...securityHeaders,
      'content-type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    });
    const stream = createReadStream(filePath);
    // Sem este handler, uma falha de leitura depois do stat (arquivo removido,
    // permissao alterada, EIO) emitia 'error' sem listener e derrubava o processo
    // inteiro - o try/catch nao alcanca evento assincrono. Os headers ja foram
    // enviados aqui, entao so resta encerrar a resposta.
    stream.on('error', (error) => {
      console.error(`[erro] leitura de ${filePath}`, error);
      res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch {
    json(res, 404, { error: 'Arquivo nao encontrado.' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/catalog') return json(res, 200, await readCatalog());
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { catalogBaseUrl, authRequired: requireAuth });
    if (req.method === 'POST' && url.pathname === '/api/validate-key') {
      const result = checkGeneratorKey(req);
      return json(res, result.status, result.ok ? { ok: true } : { error: result.error });
    }
    if (req.method === 'GET' && url.pathname === '/api/llm-config') {
      if (!requireGeneratorKey(req, res)) return;
      return json(res, 200, await readLlmConfig());
    }
    if (req.method === 'POST' && url.pathname === '/api/llm-config') {
      if (!requireGeneratorKey(req, res)) return;
      return json(res, 200, await saveLlmConfig(await readBody(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/llm-models') {
      if (!requireGeneratorKey(req, res)) return;
      return json(res, 200, await listLlmModels(await readBody(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      if (!requireGeneratorKey(req, res)) return;
      return json(res, 200, await chatWithAssistant(await readBody(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      if (!requireGeneratorKey(req, res)) return;
      return json(res, 200, await generateTraining(await readBody(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/revise') {
      if (!requireGeneratorKey(req, res)) return;
      return json(res, 200, await reviseTraining(await readBody(req)));
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, trainingRoot });
    return serveStatic(req, res);
  } catch (error) {
    // Erros internos (ENOENT com caminho absoluto, falhas de parse, etc.) ficam
    // no log. O cliente so recebe mensagens marcadas como expostas.
    if (error?.expose) {
      console.warn(`[recusado] ${req.method} ${req.url} -> ${error.status || 400}: ${error.message}`);
      return json(res, error.status || 400, { error: error.message });
    }
    console.error(`[erro] ${req.method} ${req.url}`, error);
    return json(res, 500, { error: 'Erro interno no gerador.' });
  }
});

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  server.listen(port, () => {
    console.log(`Gerador de treinamentos 3F em http://localhost:${port}`);
    console.log(`Training root: ${trainingRoot}`);
  });
}

export {
  RequestError,
  addRevisionSlides,
  assertAllowedLlmUrl,
  comparableText,
  coverTitleHtml,
  dedupeLines,
  esc,
  hostOf,
  extractBriefingFromMessages,
  fallbackPlan,
  fallbackRevisePlan,
  mergeDescription,
  normalizeBriefing,
  normalizePlan,
  normalizeSlide,
  parseEnv,
  renderDeck,
  requestedSlideCount,
  resolveDeckFile,
  reusableSlotKey,
  serializeEnv,
  server,
  slugify,
  stripListMarker,
  text,
  truncated,
  withSlideLimit
};
