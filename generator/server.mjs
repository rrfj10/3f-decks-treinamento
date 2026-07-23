import http from 'node:http';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const trainingRoot = path.resolve(process.env.TRAINING_ROOT || path.join(__dirname, '..', 'treinamentos'));
const deckRoot = path.join(trainingRoot, 'decks');
const catalogPath = path.join(trainingRoot, 'catalog.json');
const port = Number(process.env.PORT || 3000);
const catalogBaseUrl = process.env.CATALOG_BASE_URL || '';
const requireAuth = String(process.env.GENERATOR_REQUIRE_AUTH ?? 'true').toLowerCase() !== 'false';
const generatorApiKey = (process.env.GENERATOR_API_KEY || '').trim();
const briefingLabelPattern = /^(titulo|título|nome do treinamento|tema|assunto|area|área|setor|publico|público|audiencia|audiência|objetivo|foco|duracao|duração|tempo|nivel|nível|conhecimento|tom|linguagem|quantidade de slides|qtd slides|slides|topicos|tópicos|atividade|dinamica|dinâmica|pratica|prática|avaliacao|avaliação|prova|quiz)\s*:/i;

if (requireAuth && !generatorApiKey) {
  throw new Error('GENERATOR_API_KEY precisa estar configurada quando GENERATOR_REQUIRE_AUTH=true.');
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function slugify(value) {
  return String(value || 'treinamento')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 72) || 'treinamento';
}

async function uniqueDeckFile(areaDir, title) {
  const base = slugify(title);
  for (let version = 1; version <= 999; version += 1) {
    const fileSlug = `${base}_v${version}.html`;
    try {
      await stat(path.join(areaDir, fileSlug));
    } catch {
      return { fileSlug, version: `v${version}` };
    }
  }
  throw new Error('Limite de versões atingido para este treinamento.');
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function hasValidGeneratorKey(req) {
  if (!requireAuth) return true;
  const received = String(req.headers['x-api-key'] || '').trim();
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(generatorApiKey);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function requireGeneratorKey(req, res) {
  if (hasValidGeneratorKey(req)) return true;
  json(res, 401, { error: 'Chave de acesso invalida ou ausente.' });
  return false;
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_200_000) throw new Error('Payload muito grande.');
  }
  return body ? JSON.parse(body) : {};
}

async function readCatalog() {
  try {
    return JSON.parse(await readFile(catalogPath, 'utf8'));
  } catch {
    return { trainings: [] };
  }
}

async function writeCatalog(entry) {
  const catalog = await readCatalog();
  const existing = catalog.trainings.filter((item) => item.file !== entry.file);
  catalog.trainings = [...existing, entry].sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
}

function fallbackPlan(input) {
  const title = input.title?.trim() || 'Novo Treinamento';
  const area = input.area?.trim() || 'geral';
  const audience = input.audience?.trim() || 'operação interna';
  const objective = input.objective?.trim() || 'Padronizar conhecimento e orientar a execução.';
  const raw = input.description?.trim() || 'Apresente os principais conceitos, boas práticas e fechamento.';
  const topics = raw.split(/\n+/)
    .map((line) => line.replace(/^[-*\d. )]+/, '').trim())
    .filter((line) => line && !briefingLabelPattern.test(line))
    .slice(0, 8);
  const core = topics.length ? topics : [
    'Contexto e importância do tema',
    'Principais conceitos',
    'Passo a passo operacional',
    'Boas práticas',
    'Dúvidas frequentes'
  ];

  return normalizePlan({
    title,
    area,
    subtitle: `Treinamento para ${audience}`,
    objective,
    slides: [
      { type: 'cover', title, subtitle: objective },
      { type: 'cards', title: 'Objetivos do treinamento', items: [
        { icon: 'fa-bullseye', title: 'Clareza', text: objective },
        { icon: 'fa-users', title: 'Público', text: audience },
        { icon: 'fa-circle-check', title: 'Aplicação', text: 'Transformar conteúdo em rotina prática.' }
      ] },
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
      { type: 'closing', title: 'Encerramento', subtitle: 'Revise os pontos principais e alinhe dúvidas antes de aplicar na operação.' }
    ]
  });
}

async function llmPlan(input) {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return { plan: fallbackPlan(input), mode: 'fallback', warning: 'LLM_API_KEY/OPENAI_API_KEY nao configurada.' };

  const apiUrl = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.LLM_MODEL || 'gpt-4.1-mini';
  const schemaInstruction = `Responda apenas JSON valido, sem markdown. Schema:
{"title":"string","area":"string","subtitle":"string","objective":"string","slides":[{"type":"cover|cards|checklist|flow|table|closing","title":"string","subtitle":"string","lead":"string","items":[{"icon":"fa-name","title":"string","text":"string"}],"rows":[["col1","col2"]]}]}`;

  const payload = {
    model,
    temperature: 0.35,
    messages: [
      { role: 'system', content: `Voce cria roteiros de treinamentos corporativos em pt-BR para decks HTML da 3F Contact Center. ${schemaInstruction}` },
      { role: 'user', content: JSON.stringify(input, null, 2) }
    ]
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ''));
    return { plan: normalizePlan(parsed), mode: 'llm' };
  } catch (error) {
    return { plan: fallbackPlan(input), mode: 'fallback', warning: `Falha na LLM: ${error.message}` };
  }
}

function extractBriefingFromMessages(messages, currentBriefing = {}) {
  const text = messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')?.content || '';
  const slideBlock = lastUser.match(/(?:slides?|topicos|tópicos)\s*:\s*([\s\S]+)/i)?.[1] || '';
  const linesSource = slideBlock || lastUser;
  const lines = linesSource.split(/\n+/)
    .map((line) => line.replace(/^[-*\d. )]+/, '').trim())
    .filter((line) => line && !briefingLabelPattern.test(line));
  const briefing = {
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
    description: currentBriefing.description || ''
  };

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
    ['evaluation', /(?:avaliacao|avaliação|prova|quiz)[ \t]*[:=-][ \t]*([^\n]+)/i]
  ];

  for (const [key, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) briefing[key] = match[1].split('\n')[0].trim();
  }

  if (!briefing.title && lines.length) briefing.title = lines[0].slice(0, 80);
  if (!briefing.description) briefing.description = lines.join('\n');
  else if (lines.length) {
    const newLines = lines.filter((line) => !briefing.description.includes(line));
    if (newLines.length) briefing.description = `${briefing.description}\n${newLines.join('\n')}`.trim();
  }

  return briefing;
}

function briefingSlides(briefing) {
  const raw = briefing.description || '';
  return raw.split(/\n+/)
    .map((line) => line.replace(/^[-*\d. )]+/, '').trim())
    .filter(Boolean)
    .slice(0, 10);
}

function localChatReply(messages, briefing) {
  const missing = [];
  if (!briefing.title) missing.push('título');
  if (!briefing.area) missing.push('área/setor');
  if (!briefing.audience) missing.push('público-alvo');
  if (!briefing.objective) missing.push('objetivo');
  if (!briefing.duration) missing.push('duração');
  if (briefingSlides(briefing).length < 3) missing.push('ao menos 3 tópicos de slides');

  if (missing.length) {
    return `Entendi. Para deixar o treinamento pronto para gerar, ainda preciso de: ${missing.join(', ')}.\n\nPode responder em texto livre ou neste formato:\nTítulo: ...\nTema: ...\nÁrea: ...\nPúblico: ...\nObjetivo: ...\nDuração: ...\nSlides:\n- ...\n- ...`;
  }

  const slideCount = briefingSlides(briefing).length + 3;
  return `Briefing suficiente para gerar um primeiro rascunho.\n\nResumo:\n- Título: ${briefing.title}\n- Tema: ${briefing.theme || 'Ainda não informado'}\n- Área: ${briefing.area}\n- Público: ${briefing.audience}\n- Objetivo: ${briefing.objective}\n- Duração: ${briefing.duration}\n- Estrutura estimada: ${slideCount} slides\n\nSe quiser, refine exemplos, tom de voz ou pontos obrigatórios. Caso contrário, clique em "Gerar treinamento".`;
}

async function chatWithAssistant(input) {
  const messages = Array.isArray(input.messages) ? input.messages.slice(-20) : [];
  const briefing = extractBriefingFromMessages(messages, input.briefing || {});
  const draftPlan = fallbackPlan(briefing);
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      mode: 'fallback',
      briefing,
      draftPlan,
      reply: localChatReply(messages, briefing),
      warning: 'LLM_API_KEY/OPENAI_API_KEY nao configurada.'
    };
  }

  const apiUrl = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.LLM_MODEL || 'gpt-4.1-mini';
  const system = `Voce e um consultor de design instrucional da 3F Contact Center.
Ajude o usuario a refinar o briefing de um treinamento corporativo.
Responda apenas JSON valido com este schema:
{"reply":"mensagem curta em pt-BR","briefing":{"title":"string","theme":"string","area":"string","audience":"string","objective":"string","duration":"string","level":"string","tone":"string","slideTarget":"string","practice":"string","evaluation":"string","description":"topicos dos slides em linhas"}}
Nao gere HTML. Nao invente dados especificos quando faltar contexto; faca perguntas objetivas.`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ briefing, messages }, null, 2) }
        ]
      })
    });
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ''));
    const mergedBriefing = { ...briefing, ...(parsed.briefing || {}) };
    return {
      mode: 'llm',
      briefing: mergedBriefing,
      draftPlan: fallbackPlan(mergedBriefing),
      reply: parsed.reply || localChatReply(messages, mergedBriefing)
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

function normalizePlan(plan) {
  const title = String(plan.title || plan.titulo || 'Novo Treinamento').trim();
  const area = String(plan.area || 'geral').trim();
  const slides = Array.isArray(plan.slides) ? plan.slides : [];
  const normalized = slides.map((slide) => ({
    type: ['cover', 'cards', 'checklist', 'flow', 'table', 'closing'].includes(slide.type) ? slide.type : 'cards',
    title: String(slide.title || 'Slide').trim(),
    subtitle: String(slide.subtitle || '').trim(),
    lead: String(slide.lead || '').trim(),
    items: Array.isArray(slide.items) ? slide.items.slice(0, 6).map((item) => ({
      icon: String(item.icon || 'fa-circle-check').replace(/^fas\s+/, ''),
      title: String(item.title || item.titulo || 'Ponto').trim(),
      text: String(item.text || item.texto || '').trim()
    })) : [],
    rows: Array.isArray(slide.rows) ? slide.rows.slice(0, 8) : []
  }));
  if (!normalized.length || normalized[0].type !== 'cover') {
    normalized.unshift({ type: 'cover', title, subtitle: plan.objective || plan.subtitle || '', lead: '', items: [], rows: [] });
  }
  if (normalized.at(-1)?.type !== 'closing') {
    normalized.push({ type: 'closing', title: 'Encerramento', subtitle: 'Obrigado pela participação.', lead: '', items: [], rows: [] });
  }
  return {
    title,
    area,
    subtitle: String(plan.subtitle || '').trim(),
    objective: String(plan.objective || '').trim(),
    slides: normalized.slice(0, 24)
  };
}

function menuIcon(type) {
  return {
    cover: 'fa-house',
    cards: 'fa-layer-group',
    checklist: 'fa-list-check',
    flow: 'fa-diagram-project',
    table: 'fa-table',
    closing: 'fa-award'
  }[type] || 'fa-circle';
}

function renderSlide(slide, index) {
  if (slide.type === 'cover') {
    return `<section class="slide${index === 0 ? ' active' : ''}">
<div class="capa-layout">
<div class="capa-eyebrow">Universidade Corporativa &bull; ${esc(slide.subtitle || 'Treinamento')}</div>
<h1 class="capa-title">${esc(slide.title).replace(/\s+-\s+/g, '<br><span class="gradient-title">')}${slide.title.includes(' - ') ? '</span>' : ''}</h1>
<p class="capa-subtitle">${esc(slide.subtitle)}</p>
<div class="capa-divider"></div>
</div>
</section>`;
  }
  if (slide.type === 'checklist') {
    return `<section class="slide">
<div class="badge"><i class="fas ${menuIcon(slide.type)}"></i> ${String(index).padStart(2, '0')}</div>
<h2>${esc(slide.title)}</h2>
${slide.lead ? `<p class="lead">${esc(slide.lead)}</p>` : ''}
<div class="big-check">${slide.items.map((item) => `<div class="big-check-item"><i class="fas fa-circle-check"></i><span>${esc(item.title)}${item.text ? ` - ${esc(item.text)}` : ''}</span></div>`).join('')}</div>
</section>`;
  }
  if (slide.type === 'flow') {
    return `<section class="slide">
<div class="badge"><i class="fas ${menuIcon(slide.type)}"></i> Processo</div>
<h2>${esc(slide.title)}</h2>
${slide.lead ? `<p class="lead">${esc(slide.lead)}</p>` : ''}
<div class="flow-steps">${slide.items.map((item, i) => `<div class="flow-step"><div class="step-num">${String(i + 1).padStart(2, '0')}</div><div class="step-icon"><i class="fas ${esc(item.icon)}"></i></div><div class="step-label">${esc(item.title)}</div></div>${i < slide.items.length - 1 ? '<div class="flow-arrow"><i class="fas fa-arrow-right"></i></div>' : ''}`).join('')}</div>
</section>`;
  }
  if (slide.type === 'table') {
    return `<section class="slide">
<div class="badge"><i class="fas ${menuIcon(slide.type)}"></i> Referência</div>
<h2>${esc(slide.title)}</h2>
<table class="simple-table"><tbody>${slide.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>
</section>`;
  }
  if (slide.type === 'closing') {
    return `<section class="slide">
<div class="badge"><i class="fas fa-award"></i> Encerramento</div>
<div class="capa-layout">
<div class="capa-eyebrow">Treinamento Concluído</div>
<h2 style="font-family:'Orbitron',sans-serif;font-size:clamp(26px,4vw,58px);text-align:center;">${esc(slide.title)}</h2>
<p class="capa-subtitle">${esc(slide.subtitle || slide.lead || 'Obrigado pela participação.')}</p>
<div class="capa-divider"></div>
</div>
</section>`;
  }
  return `<section class="slide">
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
*{margin:0;padding:0;box-sizing:border-box}:root{--primary:#003467;--secondary:#003D38;--accent:#F0C55A;--light:#5E88C1;--dark:#04101d;--card:rgba(8,20,40,.72);--border:rgba(94,136,193,.22)}body{font-family:'Montserrat',sans-serif;background:#020B16;color:white;overflow:hidden;height:100vh}body:before{content:'';position:fixed;inset:0;background:radial-gradient(circle at top right,rgba(94,136,193,.18),transparent 35%),radial-gradient(circle at bottom left,rgba(240,197,90,.08),transparent 25%),linear-gradient(135deg,#010B15,#021325,#00152A);z-index:-2}body:after{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px);background-size:28px 28px;opacity:.35;z-index:-1}.sidebar{position:fixed;left:0;top:0;width:260px;height:100vh;background:rgba(0,0,0,.28);backdrop-filter:blur(18px);border-right:1px solid rgba(255,255,255,.06);padding:28px 20px;z-index:100;overflow-y:auto;transition:width .28s ease,padding .28s ease}.sidebar-collapse-btn{width:34px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:var(--accent);cursor:pointer;display:grid;place-items:center;transition:.25s}.sidebar-collapse-btn:hover{background:rgba(240,197,90,.12);border-color:rgba(240,197,90,.3)}.logo{margin-bottom:25px}.logo img{width:180px;object-fit:contain;transition:width .28s ease}.logo .logo-compact{display:none}.training-title{font-family:'Orbitron',sans-serif;font-size:24px;font-weight:800;line-height:1.2;color:var(--accent);margin-bottom:10px;text-transform:uppercase}.training-subtitle{font-size:13px;line-height:1.6;color:#C4D7F3;margin-bottom:26px}.menu-title{font-size:12px;letter-spacing:0;text-transform:uppercase;color:#7F9BC0;margin-bottom:14px}.menu{display:flex;flex-direction:column;gap:9px}.menu-item{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:14px;background:rgba(255,255,255,.02);border:1px solid transparent;cursor:pointer;transition:.35s}.menu-item:hover,.menu-item.active{background:rgba(94,136,193,.12);border-color:rgba(94,136,193,.25);transform:translateX(4px)}.menu-item i{width:20px;text-align:center;color:var(--accent)}.menu-item strong{display:block;font-size:14px;font-weight:600}.menu-item span{font-size:11px;color:#B4C7E7}.progress-card{margin-top:24px;padding:18px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}.progress-card h4{font-size:12px;margin-bottom:12px;color:#B4C7E7}.progress-bar,.top-progress .bar{height:8px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden}.progress-fill,.bar-fill{height:100%;width:0;background:linear-gradient(90deg,var(--accent),#FFE082);transition:.4s}.progress-info{margin-top:10px;display:flex;justify-content:space-between;font-size:12px}.main{margin-left:260px;height:100vh;position:relative;overflow:hidden;transition:margin-left .28s ease}.topbar{position:fixed;left:260px;right:0;top:0;height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:rgba(0,0,0,.15);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.05);z-index:99;transition:left .28s ease}.top-progress{width:50%}.top-progress-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}.top-progress span{font-size:12px;color:#C8D8F2;display:block;margin-bottom:10px}.top-progress-head span{margin-bottom:0}.top-actions{display:flex;justify-content:flex-end;gap:10px}.action-btn{padding:8px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:white;text-decoration:none;cursor:pointer;font-size:13px;line-height:1;white-space:nowrap;display:flex;align-items:center;justify-content:center;gap:8px}.action-btn:hover{background:rgba(240,197,90,.12);border-color:rgba(240,197,90,.2)}body.sidebar-collapsed .sidebar{width:78px;padding:28px 12px;overflow:hidden}body.sidebar-collapsed .sidebar-collapse-btn i{transform:rotate(180deg)}body.sidebar-collapsed .logo{margin-top:0;margin-bottom:24px}body.sidebar-collapsed .logo .logo-wide{display:none}body.sidebar-collapsed .logo .logo-compact{display:block;width:42px;margin:0 auto}body.sidebar-collapsed .training-title,body.sidebar-collapsed .training-subtitle,body.sidebar-collapsed .menu-title,body.sidebar-collapsed .progress-card,body.sidebar-collapsed .menu-item strong,body.sidebar-collapsed .menu-item span{display:none}body.sidebar-collapsed .menu-item{width:46px;height:46px;display:grid;place-items:center;gap:0;padding:0;border-radius:14px;margin:0 auto}body.sidebar-collapsed .menu-item i{width:auto;min-width:0;margin:0;font-size:17px;line-height:1}body.sidebar-collapsed .menu-item:hover,body.sidebar-collapsed .menu-item.active{transform:none}body.sidebar-collapsed .main{margin-left:78px}body.sidebar-collapsed .topbar,body.sidebar-collapsed .slide-footer{left:78px}.slides{height:100vh;position:relative}.slide{position:absolute;inset:0;padding:88px 48px 72px;overflow-y:auto;opacity:0;transform:translateX(40px);transition:.45s ease}.slide.active{opacity:1;transform:translateX(0);z-index:2}.badge{display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;background:rgba(94,136,193,.12);border:1px solid rgba(94,136,193,.28);color:#C4D7F3;font-size:14px;font-weight:600;margin-bottom:18px}.badge i{color:var(--accent)}h1,h2{font-family:'Orbitron',sans-serif;text-transform:uppercase;line-height:1.08;letter-spacing:0}h2{font-size:clamp(30px,4.2vw,64px);margin-bottom:22px}.gradient-title{background:linear-gradient(90deg,#fff,#F0C55A);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.lead{font-size:18px;line-height:1.7;color:#C4D7F3;max-width:900px;margin-bottom:26px}.capa-layout{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px}.capa-eyebrow{color:#C4D7F3;letter-spacing:0;text-transform:uppercase;font-size:14px}.capa-title{font-size:clamp(34px,6vw,76px)}.capa-subtitle{font-size:clamp(18px,2vw,28px);color:#C4D7F3}.capa-divider{width:120px;height:4px;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--light));margin:6px auto}.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{position:relative;padding:24px;border-radius:18px;background:var(--card);border:1px solid var(--border);overflow:hidden}.card:before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--accent),var(--light))}.card i{font-size:28px;color:var(--accent);margin-bottom:16px}.card h3{font-size:20px;margin-bottom:10px}.card p{font-size:15px;line-height:1.6;color:#C4D7F3}.big-check{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.big-check-item{display:flex;align-items:center;gap:14px;padding:20px;border-radius:18px;background:var(--card);border:1px solid var(--border);font-size:18px}.big-check-item i{color:#74FF9F}.flow-steps{display:flex;align-items:stretch;gap:14px;flex-wrap:wrap}.flow-step{flex:1;min-width:160px;padding:20px;border-radius:18px;background:var(--card);border:1px solid var(--border);text-align:center}.step-num{font-family:'Orbitron';color:var(--accent);font-size:13px}.step-icon{font-size:26px;color:var(--accent);margin:12px}.step-label{font-weight:700}.flow-arrow{display:flex;align-items:center;color:var(--accent)}.simple-table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:18px;overflow:hidden}.simple-table td{padding:16px;border-bottom:1px solid var(--border);font-size:15px}.slide-footer{position:fixed;left:260px;right:0;bottom:0;height:60px;display:flex;align-items:center;justify-content:center;gap:30px;padding:0 55px;background:linear-gradient(to top,rgba(2,11,22,.95) 60%,transparent);z-index:90;pointer-events:none;transition:left .28s ease}.slide-footer:before,.slide-footer:after{content:'';height:1px;flex:1;background:linear-gradient(90deg,transparent,rgba(240,197,90,.3))}.slide-footer img{width:160px;opacity:.85}#drawCanvas{position:fixed;inset:0;z-index:85;pointer-events:none}@media(max-width:980px){.sidebar{left:-270px;transition:.3s}.sidebar.open{left:0}.main{margin-left:0}.topbar{left:0}.slide-footer{left:0;padding:0 24px}.grid-3,.big-check{grid-template-columns:1fr}.slide{padding:88px 22px 72px}.btn-label{display:none}body.sidebar-collapsed .sidebar{width:260px;padding:28px 20px}body.sidebar-collapsed .main{margin-left:0}body.sidebar-collapsed .topbar,body.sidebar-collapsed .slide-footer{left:0}body.sidebar-collapsed .logo{margin-top:0;margin-bottom:25px}body.sidebar-collapsed .logo img{width:180px}body.sidebar-collapsed .logo .logo-wide{display:block}body.sidebar-collapsed .logo .logo-compact{display:none}body.sidebar-collapsed .training-title,body.sidebar-collapsed .training-subtitle,body.sidebar-collapsed .menu-title,body.sidebar-collapsed .progress-card,body.sidebar-collapsed .menu-item strong,body.sidebar-collapsed .menu-item span{display:block}}
body.light-mode{background:#F4F7FB;color:#102033;}
body.light-mode:before{background:radial-gradient(circle at top right,rgba(94,136,193,.18),transparent 35%),radial-gradient(circle at bottom left,rgba(240,197,90,.14),transparent 25%),linear-gradient(135deg,#F8FAFE,#EAF0F8,#DDE8F5);}
body.light-mode:after{background-image:linear-gradient(rgba(0,52,103,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(0,52,103,.055) 1px,transparent 1px);opacity:.55;}
body.light-mode .sidebar,body.light-mode .topbar,body.light-mode .card,body.light-mode .progress-card,body.light-mode .menu-item,body.light-mode .action-btn,body.light-mode .simple-table,body.light-mode .big-check-item,body.light-mode .flow-step{background:rgba(255,255,255,.78);border-color:rgba(0,52,103,.16);box-shadow:0 18px 55px rgba(0,52,103,.08);}
body.light-mode .kpi-card,body.light-mode .message-box,body.light-mode .mission-values-box,body.light-mode .col-block,body.light-mode .tool-card,body.light-mode .comp-card,body.light-mode .level-card,body.light-mode .orbit-card,body.light-mode .timeline-item,body.light-mode .hub-node,body.light-mode .annot-item,body.light-mode .faq-item,body.light-mode .gallery-item,body.light-mode .final-msg-box{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(239,245,252,.92));border-color:rgba(0,52,103,.16);box-shadow:0 18px 45px rgba(0,52,103,.08);}
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
body.light-mode .menu-title{color:#45617F;}
body.light-mode .slide,body.light-mode .menu-item strong,body.light-mode .card h3,body.light-mode h2{color:#102033;}
body.light-mode .menu-item:hover,body.light-mode .menu-item.active,body.light-mode .action-btn:hover{background:rgba(94,136,193,.13);border-color:rgba(0,52,103,.18);}
body.light-mode .badge{background:rgba(0,52,103,.07);border-color:rgba(0,52,103,.16);color:#244567;}
body.light-mode .slide-footer{background:linear-gradient(to top,rgba(244,247,251,.96) 60%,transparent);}
body.light-mode .slide-footer:before,body.light-mode .slide-footer:after{background:linear-gradient(90deg,transparent,rgba(0,52,103,.34));}
body.light-mode .sidebar-collapse-btn{background:rgba(0,52,103,.06);border-color:rgba(0,52,103,.14);}
body.light-mode .gradient-title{background:linear-gradient(90deg,#003467,#1F6EAA 58%,#B88A22);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
body.light-mode .slide p,body.light-mode .slide li,body.light-mode .slide span:not(.gradient-title),body.light-mode .slide strong,body.light-mode .slide h3,body.light-mode .value,body.light-mode .values-title,body.light-mode .message-box p,body.light-mode .mission-values-box p,body.light-mode .col-block li,body.light-mode .tool-card p,body.light-mode .comp-card p,body.light-mode .level-card p,body.light-mode .orbit-card p,body.light-mode .timeline-item p{color:#244567!important;}
body.light-mode .slide h1,body.light-mode .slide h2,body.light-mode .capa-title,body.light-mode .message-box h3,body.light-mode .table-title,body.light-mode .col-block-title,body.light-mode .tool-card .tool-name,body.light-mode .comp-card h3,body.light-mode .level-card h3,body.light-mode .orbit-card h4,body.light-mode .timeline-item h3{color:#102033!important;}
body.light-mode .gradient-title{background:linear-gradient(90deg,#003467,#1F6EAA 58%,#B88A22)!important;-webkit-background-clip:text!important;-webkit-text-fill-color:transparent!important;}
body.light-mode .slide-counter,body.light-mode .training-title{color:#8A640C;}
body.light-mode .action-btn,body.light-mode .menu-toggle,body.light-mode .sidebar-collapse-btn,body.light-mode .nav-btn,body.light-mode .modal-close{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(235,242,250,.92));border-color:rgba(0,52,103,.22);color:#0E2F53;box-shadow:0 8px 22px rgba(0,52,103,.08);}
body.light-mode .action-btn i,body.light-mode .menu-toggle i,body.light-mode .sidebar-collapse-btn i,body.light-mode .nav-btn i,body.light-mode .modal-close i{color:#003467;}
body.light-mode .action-btn:hover,body.light-mode .menu-toggle:hover,body.light-mode .sidebar-collapse-btn:hover,body.light-mode .nav-btn:hover,body.light-mode .modal-close:hover{background:linear-gradient(180deg,rgba(231,240,252,.98),rgba(213,229,247,.95));border-color:rgba(0,52,103,.32);}
body.light-mode .theme-toggle{border-color:rgba(184,138,34,.35);}
body.light-mode .theme-toggle i{color:#B88A22;}
.theme-toggle{width:38px;min-width:38px;padding:0;aspect-ratio:1;border-radius:12px;}
.theme-toggle i{color:var(--accent);}
</style>
</head>
<body>
<div class="sidebar">
<div class="logo"><img class="logo-wide" data-asset="logo3f" alt="3F Contact Center"><img class="logo-compact" data-asset="logo3fVertical" alt="3F Contact Center"></div>
<div class="training-title">${esc(plan.title)}</div>
<div class="training-subtitle">${esc(plan.area)}<br>• Universidade Corporativa</div>
<div class="menu-title">Módulos</div>
<div class="menu">${plan.slides.map((slide, i) => `<div class="menu-item${i === 0 ? ' active' : ''}" onclick="goSlide(${i})"><i class="fas ${menuIcon(slide.type)}"></i><div><strong>${esc(slide.title).slice(0, 22)}</strong><span>Slide ${i + 1}</span></div></div>`).join('')}</div>
<div class="progress-card"><h4>PROGRESSO DO TREINAMENTO</h4><div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div><div class="progress-info"><span id="progressText">1 / ${total}</span><span style="color:#74FF9F;">Em andamento</span></div></div>
</div>
<div class="main">
<div class="topbar"><div class="top-progress"><div class="top-progress-head"><button class="sidebar-collapse-btn" type="button" onclick="toggleSidebar()" title="Recolher menu lateral" aria-label="Recolher menu lateral"><i class="fas fa-chevron-left"></i></button><span>PROGRESSO GERAL</span></div><div class="bar"><div class="bar-fill" id="topProgress"></div></div></div><div class="top-actions"><a class="action-btn" href="/index.html"><i class="fas fa-house"></i><span class="btn-label">Catálogo</span></a><div class="action-btn" onclick="toggleFullscreen()"><i class="fas fa-expand" id="fsIcon"></i><span class="btn-label">Tela Cheia</span></div><div class="action-btn" id="penBtn" onclick="togglePen()"><i class="fas fa-pen-nib"></i><span class="btn-label">Marcador</span></div><div class="slide-counter" id="slideCounter">01 / 00</div><button class="action-btn theme-toggle" type="button" onclick="toggleTheme()" title="Alternar tema" aria-label="Alternar tema"><i class="fas fa-sun"></i></button></div></div>
<div class="slides">${plan.slides.map(renderSlide).join('\n')}</div>
<div class="slide-footer"><img data-asset="logo3f" alt="3F Contact Center"></div>
</div>
<canvas id="drawCanvas"></canvas>
<script>
function applyConfiguredAssets(mode=localStorage.getItem('3f-theme')||'dark'){const light=mode==='light';document.body.classList.toggle('light-mode',light);document.querySelectorAll('[data-asset]').forEach((el)=>{const key=el.dataset.asset;const lightKey=key+'Light';const asset=window.TRAINING_CONFIG.assets[light&&window.TRAINING_CONFIG.assets[lightKey]?lightKey:key];if(el.tagName==='IMG')el.src=asset;else el.style.backgroundImage='url("'+asset+'")';});document.querySelectorAll('.theme-toggle').forEach((btn)=>{btn.innerHTML=light?'<i class="fas fa-moon"></i>':'<i class="fas fa-sun"></i>';btn.setAttribute('aria-label',light?'Ativar tema escuro':'Ativar tema claro');btn.setAttribute('title',light?'Ativar tema escuro':'Ativar tema claro');});}
function setTheme(mode){localStorage.setItem('3f-theme',mode);applyConfiguredAssets(mode)}
function toggleTheme(){setTheme(document.body.classList.contains('light-mode')?'dark':'light')}
function toggleSidebar(){document.body.classList.toggle('sidebar-collapsed');}
const slides=document.querySelectorAll('.slide'),menuItems=document.querySelectorAll('.menu-item'),progressFill=document.getElementById('progressFill'),topProgress=document.getElementById('topProgress'),progressText=document.getElementById('progressText'),slideCounter=document.getElementById('slideCounter');let current=0;function pad(n){return String(n).padStart(2,'0')}function updateSlides(){slides.forEach((s,i)=>s.classList.toggle('active',i===current));menuItems.forEach((m,i)=>m.classList.toggle('active',i===current));const p=((current+1)/slides.length)*100;progressFill.style.width=p+'%';topProgress.style.width=p+'%';progressText.innerHTML=(current+1)+' / '+slides.length;slideCounter.textContent=pad(current+1)+' / '+pad(slides.length)}function nextSlide(){if(current<slides.length-1){current++;updateSlides()}}function prevSlide(){if(current>0){current--;updateSlides()}}function goSlide(i){current=i;updateSlides()}window.addEventListener('keydown',(e)=>{if(e.target.matches('input,textarea'))return;const k=e.key.toLowerCase();if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();nextSlide()}if(e.key==='ArrowLeft')prevSlide();if(e.key==='Home'){current=0;updateSlides()}if(e.key==='End'){current=slides.length-1;updateSlides()}if(k==='f')toggleFullscreen();if(k==='d')togglePen();if(k==='c')clearDraw();});function toggleFullscreen(){const d=document.documentElement;if(!document.fullscreenElement)(d.requestFullscreen||function(){}).call(d);else(document.exitFullscreen||function(){}).call(document)}const drawCanvas=document.getElementById('drawCanvas'),drawCtx=drawCanvas.getContext('2d');let penOn=false,drawing=false;function resizeCanvas(){drawCanvas.width=window.innerWidth;drawCanvas.height=window.innerHeight;drawCtx.strokeStyle='#F0C55A';drawCtx.lineWidth=3;drawCtx.lineCap='round';drawCtx.lineJoin='round'}function clearDraw(){drawCtx.clearRect(0,0,drawCanvas.width,drawCanvas.height)}function togglePen(){penOn=!penOn;drawCanvas.style.pointerEvents=penOn?'auto':'none';drawCanvas.style.cursor=penOn?'crosshair':'';const b=document.getElementById('penBtn');if(b)b.style.borderColor=penOn?'rgba(240,197,90,.45)':'';if(penOn)resizeCanvas()}drawCanvas.addEventListener('pointerdown',e=>{if(!penOn)return;drawing=true;drawCtx.beginPath();drawCtx.moveTo(e.clientX,e.clientY)});drawCanvas.addEventListener('pointermove',e=>{if(!penOn||!drawing)return;drawCtx.lineTo(e.clientX,e.clientY);drawCtx.stroke()});window.addEventListener('pointerup',()=>drawing=false);window.addEventListener('resize',()=>{if(penOn)resizeCanvas()});new MutationObserver(clearDraw).observe(document.querySelector('.slides'),{attributes:true,subtree:true,attributeFilter:['class']});applyConfiguredAssets();updateSlides();
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
  const { fileSlug, version } = await uniqueDeckFile(areaDir, plan.title);
  const filePath = path.join(areaDir, fileSlug);
  await writeFile(filePath, renderDeck(plan));
  const relFile = `decks/${areaSlug}/${fileSlug}`;
  await writeCatalog({
    title: plan.title,
    area: plan.area,
    version,
    file: relFile,
    status: 'Rascunho gerado',
    description: input.objective || plan.objective || plan.subtitle || ''
  });
  return { ...result, file: relFile, url: `/${relFile}`, plan };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.resolve(publicDir, `.${pathname}`);
  const relativePath = path.relative(publicDir, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return json(res, 403, { error: 'Acesso negado.' });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not file');
    res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } catch {
    json(res, 404, { error: 'Arquivo nao encontrado.' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/catalog') return json(res, 200, await readCatalog());
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { catalogBaseUrl, authRequired: requireAuth });
    if (req.method === 'POST' && url.pathname === '/api/validate-key') return json(res, hasValidGeneratorKey(req) ? 200 : 401, hasValidGeneratorKey(req) ? { ok: true } : { error: 'Chave de acesso invalida.' });
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      if (!requireGeneratorKey(req, res)) return;
      return json(res, 200, await chatWithAssistant(await readBody(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      if (!requireGeneratorKey(req, res)) return;
      return json(res, 200, await generateTraining(await readBody(req)));
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, trainingRoot });
    return serveStatic(req, res);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Gerador de treinamentos 3F em http://localhost:${port}`);
  console.log(`Training root: ${trainingRoot}`);
});
