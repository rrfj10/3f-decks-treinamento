let catalogBase = '';

const thread = document.getElementById('thread');
const composer = document.getElementById('composer');
const chatInput = document.getElementById('chatInput');
const generateBtn = document.getElementById('generateBtn');
const resetBtn = document.getElementById('resetBtn');
const resetTopBtn = document.getElementById('resetTopBtn');
const draftBtn = document.getElementById('draftBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
const themeBtn = document.getElementById('themeBtn');
const llmConfigBtn = document.getElementById('llmConfigBtn');
const llmModal = document.getElementById('llmModal');
const llmForm = document.getElementById('llmForm');
const llmCloseBtn = document.getElementById('llmCloseBtn');
const llmCancelBtn = document.getElementById('llmCancelBtn');
const llmSlot = document.getElementById('llmSlot');
const llmLabel = document.getElementById('llmLabel');
const llmApiKey = document.getElementById('llmApiKey');
const llmModel = document.getElementById('llmModel');
const llmCustomModelWrap = document.getElementById('llmCustomModelWrap');
const llmCustomModel = document.getElementById('llmCustomModel');
const llmNewApiBtn = document.getElementById('llmNewApiBtn');
const llmLoadModelsBtn = document.getElementById('llmLoadModelsBtn');
const llmApiUrl = document.getElementById('llmApiUrl');
const llmModelsUrlPreview = document.getElementById('llmModelsUrlPreview');
const llmSlotSummary = document.getElementById('llmSlotSummary');
const llmStatus = document.getElementById('llmStatus');
const statusBox = document.getElementById('statusBox');
const statusIcon = document.getElementById('statusIcon');
const statusTitle = document.getElementById('statusTitle');
const statusCard = document.getElementById('statusCard');
const progressText = document.getElementById('progressText');
const briefingBar = document.getElementById('briefingBar');
const slidesPreview = document.getElementById('slidesPreview');
const briefingPanel = document.getElementById('briefingPanel');
const slideCount = document.getElementById('slideCount');
const routeDuration = document.getElementById('routeDuration');
const resultBox = document.getElementById('resultBox');
const accessGate = document.getElementById('accessGate');
const accessForm = document.getElementById('accessForm');
const accessKeyInput = document.getElementById('accessKeyInput');
const accessError = document.getElementById('accessError');
const accessLogo = document.getElementById('accessLogo');

const fields = {
  title: document.getElementById('title'),
  theme: document.getElementById('theme'),
  area: document.getElementById('area'),
  audience: document.getElementById('audience'),
  objective: document.getElementById('objective'),
  duration: document.getElementById('duration'),
  level: document.getElementById('level'),
  tone: document.getElementById('tone'),
  slideTarget: document.getElementById('slideTarget'),
  practice: document.getElementById('practice'),
  evaluation: document.getElementById('evaluation'),
  operationType: document.getElementById('operationType'),
  kpiTarget: document.getElementById('kpiTarget'),
  operationalPain: document.getElementById('operationalPain'),
  behaviorChange: document.getElementById('behaviorChange'),
  learningEvidence: document.getElementById('learningEvidence'),
  description: document.getElementById('description')
};

const openingMessage = 'Qual treinamento você quer criar? Me diga o tema, o público e o principal objetivo.';

function newMessage(role, content) {
  return { role, content, at: nowTime() };
}

let messages = [newMessage('assistant', openingMessage)];
let draftPlan = null;
let generatedTraining = null;
let authRequired = false;
let generatorKey = sessionStorage.getItem('3f-generator-key') || '';
let llmConfig = { activeSlot: 1, slots: [] };

function fallbackCatalogBase() {
  if (location.port === '8091' || location.port === '3000') return `${location.protocol}//${location.hostname}:8088`;
  return location.origin;
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const config = response.ok ? await response.json() : {};
    catalogBase = config.catalogBaseUrl || fallbackCatalogBase();
    authRequired = Boolean(config.authRequired);
  } catch {
    catalogBase = fallbackCatalogBase();
    // Sem resposta do servidor, assume que ha autenticacao: o contrario esconde o
    // portao de acesso e todas as chamadas voltam 401 sem explicacao.
    authRequired = true;
  }
  document.getElementById('catalogLink').href = catalogBase;
  document.getElementById('catalogLinkBottom').href = catalogBase;
}

function authHeaders() {
  return authRequired ? { 'X-API-Key': generatorKey } : {};
}

function resetAccess() {
  generatorKey = '';
  sessionStorage.removeItem('3f-generator-key');
  accessKeyInput.value = '';
  accessGate.hidden = false;
  accessKeyInput.focus();
}

/** Retorna `{ ok, reason }` para distinguir chave errada de bloqueio por tentativas. */
async function validateAccessKey(key) {
  if (!authRequired) return { ok: true };
  const response = await fetch('/api/validate-key', {
    method: 'POST',
    headers: { 'X-API-Key': key }
  });
  if (response.ok) return { ok: true };
  if (response.status === 429) {
    return { ok: false, reason: 'Muitas tentativas seguidas. Aguarde um minuto antes de tentar de novo.' };
  }
  return { ok: false, reason: 'Chave invalida. Verifique e tente novamente.' };
}

async function ensureAccess() {
  if (!authRequired) {
    accessGate.hidden = true;
    return true;
  }
  if (generatorKey && (await validateAccessKey(generatorKey)).ok) {
    accessGate.hidden = true;
    return true;
  }
  generatorKey = '';
  sessionStorage.removeItem('3f-generator-key');
  accessGate.hidden = false;
  accessKeyInput.focus();
  return false;
}

async function loadLlmConfig() {
  const response = await fetch('/api/llm-config', {
    headers: authHeaders(),
    cache: 'no-store'
  });
  const payload = await response.json();
  if (response.status === 401) resetAccess();
  if (!response.ok) throw new Error(payload.error || 'Falha ao carregar configuração da LLM.');
  llmConfig = payload;
  renderLlmConfig(payload.activeSlot || 1);
  return payload;
}

function suggestedModels(apiUrl) {
  const url = String(apiUrl || '').toLowerCase();
  if (url.includes('openrouter.ai')) return ['openai/gpt-4.1-mini', 'openai/gpt-4.1', 'anthropic/claude-3.5-sonnet', 'google/gemini-1.5-pro'];
  if (url.includes('groq.com')) return ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
  if (url.includes('deepseek.com')) return ['deepseek-chat', 'deepseek-reasoner'];
  if (url.includes('mistral.ai')) return ['mistral-large-latest', 'mistral-small-latest'];
  return ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'];
}

function deriveModelsUrl(apiUrl) {
  try {
    const parsed = new URL(String(apiUrl || ''));
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
  } catch {
    return '';
  }
}

function refreshModelsUrlPreview() {
  const modelsUrl = deriveModelsUrl(llmApiUrl.value);
  llmModelsUrlPreview.textContent = modelsUrl
    ? `Consulta de modelos: ${modelsUrl}`
    : 'Consulta de modelos: informe uma URL valida primeiro';
}

function setModelOptions(models, selected) {
  const current = selected || llmModel.value || llmCustomModel.value || 'gpt-4.1-mini';
  const unique = [...new Set([current, ...models].filter(Boolean))];
  llmModel.innerHTML = unique
    .map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
    .join('') + '<option value="__custom">Modelo personalizado...</option>';
  llmModel.value = unique.includes(current) ? current : '__custom';
  llmCustomModelWrap.hidden = llmModel.value !== '__custom';
  if (llmModel.value === '__custom') llmCustomModel.value = current;
}

function selectedModelValue() {
  return llmModel.value === '__custom' ? llmCustomModel.value.trim() : llmModel.value;
}

function providerName(apiUrl) {
  const url = String(apiUrl || '').toLowerCase();
  if (url.includes('deepseek.com')) return 'DeepSeek';
  if (url.includes('openrouter.ai')) return 'OpenRouter';
  if (url.includes('groq.com')) return 'Groq';
  if (url.includes('mistral.ai')) return 'Mistral';
  if (url.includes('anthropic.com')) return 'Anthropic';
  if (url.includes('googleapis.com')) return 'Google';
  if (url.includes('openai.com')) return 'OpenAI';
  try {
    return new URL(apiUrl).hostname.replace(/^api\./, '');
  } catch {
    return 'API';
  }
}

function prepareNewApiSlot() {
  const slots = llmConfig.slots || [];
  const empty = slots.find((slot) => !slot.configured) || slots.find((slot) => slot.slot !== llmConfig.activeSlot);
  if (!empty) {
    llmStatus.textContent = 'Os 5 slots de API ja estao preenchidos. Selecione um slot existente para substituir.';
    return;
  }
  refreshLlmSlotOptions(empty.slot);
  llmSlot.value = String(empty.slot);
  llmLabel.value = `API ${empty.slot}`;
  llmApiUrl.value = 'https://api.openai.com/v1/chat/completions';
  llmApiKey.value = '';
  llmCustomModel.value = '';
  llmCustomModelWrap.hidden = true;
  setModelOptions(suggestedModels(llmApiUrl.value), 'gpt-4.1-mini');
  refreshModelsUrlPreview();
  llmSlotSummary.textContent = `Nova API no slot ${empty.slot}. Informe nome, URL, chave e modelo para salvar.`;
  llmStatus.textContent = 'Preencha os dados da nova API e clique em Salvar e ativar.';
  llmLabel.focus();
}

function providerFromConfig({ label = '', model = '', apiUrl = '' } = {}) {
  const value = `${label} ${model} ${apiUrl}`.toLowerCase();
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('openrouter')) return 'openrouter';
  if (value.includes('groq')) return 'groq';
  if (value.includes('mistral')) return 'mistral';
  if (value.includes('anthropic') || value.includes('claude')) return 'anthropic';
  if (value.includes('gemini') || value.includes('google')) return 'google';
  if (value.includes('openai') || value.includes('gpt-')) return 'openai';
  return '';
}

function providerMismatchMessage({ label, model, apiUrl }) {
  const provider = providerFromConfig({ label, model });
  if (!provider) return '';
  let host = '';
  try {
    host = new URL(apiUrl).hostname.toLowerCase();
  } catch {
    return 'Informe uma URL da API valida.';
  }
  const expected = {
    deepseek: ['deepseek.com'],
    openrouter: ['openrouter.ai'],
    groq: ['groq.com'],
    mistral: ['mistral.ai'],
    anthropic: ['anthropic.com'],
    google: ['googleapis.com'],
    openai: ['openai.com']
  }[provider] || [];
  const ok = expected.some((item) => host === item || host.endsWith(`.${item}`));
  return ok ? '' : `Modelo/provedor ${provider} nao combina com a URL ${host}. Ajuste a URL da API antes de salvar.`;
}

function refreshLlmSlotOptions(selectedSlot) {
  const slots = llmConfig.slots?.length ? llmConfig.slots : Array.from({ length: 5 }, (_, index) => ({
    slot: index + 1,
    label: `API ${index + 1}`,
    model: '',
    apiUrl: '',
    configured: false
  }));
  llmSlot.innerHTML = slots.map((slot) => {
    const label = `API ${slot.slot}`;
    return `<option value="${slot.slot}">${escapeHtml(label)}</option>`;
  }).join('');
  llmSlot.value = String(selectedSlot || llmConfig.activeSlot || 1);
}

function renderSlotSummary(slot) {
  const state = slot.configured
    ? slot.slot === llmConfig.activeSlot ? 'ativa' : 'salva'
    : 'vazia';
  const provider = providerName(slot.apiUrl);
  const model = slot.configured ? slot.model || 'modelo nao definido' : 'aguardando configuracao';
  llmSlotSummary.textContent = `Selecionada: API ${slot.slot} · ${slot.label || provider} · ${state} · ${provider} · ${model}`;
}

function renderLlmConfig(slotNumber) {
  refreshLlmSlotOptions(Number(slotNumber));
  const slot = llmConfig.slots?.find((item) => item.slot === Number(slotNumber)) || {
    slot: Number(slotNumber),
    label: `API ${slotNumber}`,
    model: 'gpt-4.1-mini',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    configured: false
  };
  renderSlotSummary(slot);
  llmSlot.value = String(slot.slot);
  llmLabel.value = slot.label || `API ${slot.slot}`;
  llmApiUrl.value = slot.apiUrl || 'https://api.openai.com/v1/chat/completions';
  refreshModelsUrlPreview();
  setModelOptions(suggestedModels(llmApiUrl.value), slot.model || 'gpt-4.1-mini');
  llmApiKey.value = '';
  llmApiKey.placeholder = slot.configured ? 'Chave ja configurada. Deixe vazio para manter.' : 'Cole a chave da LLM';
  llmStatus.textContent = slot.configured
    ? `Selecionado: ${slot.label || `API ${slot.slot}`} (${providerName(slot.apiUrl)}) usando ${slot.model || 'modelo nao definido'}. Slot ativo atual: API ${llmConfig.activeSlot}.`
    : `Slot ${slot.slot} ainda sem chave.`;
}

async function openLlmModal() {
  if (!await ensureAccess()) return;
  llmModal.hidden = false;
  llmStatus.textContent = 'Carregando configuração...';
  try {
    await loadLlmConfig();
  } catch (error) {
    llmStatus.textContent = error.message;
  }
}

function closeLlmModal() {
  llmModal.hidden = true;
}

async function saveLlmConfig() {
  const submitButtons = [...llmForm.querySelectorAll('button[type="submit"]')];
  const mismatch = providerMismatchMessage({
    label: llmLabel.value,
    model: selectedModelValue(),
    apiUrl: llmApiUrl.value
  });
  if (mismatch) {
    llmStatus.textContent = mismatch;
    return;
  }
  const previousButtons = submitButtons.map((button) => ({ button, html: button.innerHTML }));
  submitButtons.forEach((button) => {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
  });
  llmStatus.textContent = 'Salvando no .env local...';
  try {
    const response = await fetch('/api/llm-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        slot: llmSlot.value,
        label: llmLabel.value,
        apiKey: llmApiKey.value,
        model: selectedModelValue(),
        apiUrl: llmApiUrl.value
      })
    });
    const payload = await response.json();
    if (response.status === 401) resetAccess();
    if (!response.ok) throw new Error(payload.error || 'Falha ao salvar configuração.');
    llmConfig = payload;
    renderLlmConfig(payload.activeSlot);
    llmStatus.textContent = `API ${payload.activeSlot} salva e ativada. O gerador ja vai usar essa LLM.`;
  } catch (error) {
    llmStatus.textContent = error.message;
  } finally {
    previousButtons.forEach(({ button, html }) => {
      button.disabled = false;
      button.innerHTML = html;
    });
  }
}

async function loadAvailableModels() {
  const button = llmLoadModelsBtn;
  button.disabled = true;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Carregando...';
  refreshModelsUrlPreview();
  llmStatus.textContent = `Consultando modelos em ${deriveModelsUrl(llmApiUrl.value) || 'URL invalida'}...`;
  try {
    const response = await fetch('/api/llm-models', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        slot: llmSlot.value,
        apiUrl: llmApiUrl.value,
        apiKey: llmApiKey.value
      })
    });
    const payload = await response.json();
    if (response.status === 401) resetAccess();
    if (!response.ok) throw new Error(payload.error || 'Falha ao carregar modelos.');
    setModelOptions(payload.models || [], selectedModelValue());
    if (payload.modelsUrl) llmModelsUrlPreview.textContent = `Consulta de modelos: ${payload.modelsUrl}`;
    llmStatus.textContent = payload.models?.length
      ? `${payload.models.length} modelos carregados. Selecione um modelo e salve.`
      : 'A API respondeu sem lista de modelos. Use modelo personalizado.';
  } catch (error) {
    setModelOptions(suggestedModels(llmApiUrl.value), selectedModelValue());
    llmStatus.textContent = `${error.message} Usando sugestões locais; você também pode informar um modelo personalizado.`;
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-list"></i> Carregar modelos';
  }
}

function todayPtBr() {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date());
}

function setTheme(mode) {
  const light = mode === 'light';
  document.body.classList.toggle('light-mode', light);
  localStorage.setItem('3f-theme', light ? 'light' : 'dark');
  document.getElementById('brandLogo').src = `${catalogBase}/_assets/logos/${light ? 'Logo_horizontal_Azul.png' : 'Logo_horizontal_branca.png'}`;
  document.getElementById('brandLogoCompact').src = `${catalogBase}/_assets/logos/${light ? 'Logo_vertical_azul.png' : 'Logo_vertical_branca.png'}`;
  document.getElementById('footerLogo').src = `${catalogBase}/_assets/logos/${light ? 'Logo_horizontal_Azul.png' : 'Logo_horizontal_branca.png'}`;
  accessLogo.src = `${catalogBase}/_assets/logos/${light ? 'Logo_horizontal_Azul.png' : 'Logo_horizontal_branca.png'}`;
  themeBtn.innerHTML = light ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
  themeBtn.setAttribute('aria-label', light ? 'Ativar tema escuro' : 'Ativar tema claro');
  themeBtn.setAttribute('title', light ? 'Ativar tema escuro' : 'Ativar tema claro');
}

function toggleTheme() {
  setTheme(document.body.classList.contains('light-mode') ? 'dark' : 'light');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function catalogUrl(pathname = '') {
  const base = String(catalogBase || '').replace(/\/+$/, '');
  const suffix = String(pathname || '');
  if (!suffix) return base;
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function renderResultCard({ mode, title, slides, status, url }) {
  const updated = mode === 'updated';
  const kicker = updated ? 'Treinamento atualizado' : 'Treinamento criado com sucesso';
  const dateLabel = updated ? 'Revisado em' : 'Criado em';
  const trainingUrl = catalogUrl(url);
  const catalogHref = catalogUrl();
  return `<div class="result-card">
<div class="result-kicker"><i class="fas ${updated ? 'fa-rotate' : 'fa-circle-check'}"></i> ${kicker}</div>
<div class="result-title">${escapeHtml(title || 'Treinamento 3F')}</div>
<div class="result-meta">
<span><b>Slides</b>${escapeHtml(slides || '--')}</span>
<span><b>${dateLabel}</b>${todayPtBr()}</span>
<span><b>Status</b>${escapeHtml(status)}</span>
</div>
<div class="result-actions">
<a class="result-action primary" href="${escapeHtml(trainingUrl)}" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square"></i> Abrir treinamento</a>
<a class="result-action" href="${escapeHtml(catalogHref)}" target="_blank" rel="noopener"><i class="fas fa-house"></i> Catálogo</a>
</div>
</div>`;
}

function nowTime() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function fieldBriefing() {
  return Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
}

function comparableText(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeDescription(value) {
  const seen = new Set();
  return String(value || '').split(/\n+/)
    .map((line) => line.replace(/^[-*\d. )]+/, '').trim())
    .filter((line) => {
      const key = comparableText(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

function sanitizeBriefing(data) {
  const clean = {};
  for (const [key, value] of Object.entries(data || {})) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    clean[key] = key === 'description' ? dedupeDescription(text) : text;
  }
  return clean;
}

function applyBriefing(next) {
  const clean = sanitizeBriefing(next);
  for (const [key, input] of Object.entries(fields)) {
    if (clean[key] != null && clean[key] !== input.value) input.value = clean[key];
  }
}

function chipsForState(data, missing, hasSlides) {
  if (generatedTraining?.file) {
    return [
      ['Reduzir para 8 slides', 'Reduza o treinamento para oito slides mantendo objetivo, impacto operacional, atividade e encerramento.'],
      ['Mais prático', 'Deixe o treinamento mais prático e focado em situações reais da operação.'],
      ['Adicionar dinâmica', 'Adicione uma dinâmica baseada em cenário de atendimento.'],
      ['Incluir avaliação', 'Inclua uma avaliação final curta.']
    ];
  }
  if (!messages.some((message) => message.role === 'user')) {
    return [
      ['Organizar em slides', 'Me ajude a organizar esses tópicos em slides.'],
      ['Sugerir estrutura', 'Sugira uma estrutura com capa, módulos e encerramento.'],
      ['Ver informações necessárias', 'Quais informações você precisa para criar um bom treinamento operacional?'],
      ['Criar treinamento rápido', 'Quero criar um treinamento rápido. Me faça as perguntas essenciais.']
    ];
  }
  if (missing.length) {
    return [
      ['Ver informações faltantes', 'Quais informações ainda faltam?'],
      ['Definir KPI', 'Me ajude a definir o KPI impactado por esse treinamento.'],
      ['Definir público', 'Me ajude a definir o público-alvo.'],
      ['Comportamento esperado', 'Me ajude a escrever o comportamento esperado após o treinamento.']
    ];
  }
  if (hasSlides) {
    return [
      ['Adicionar exemplos', 'Inclua exemplos práticos da operação.'],
      ['Incluir dinâmica', 'Sugira uma atividade prática para esse treinamento.'],
      ['Criar avaliação', 'Crie uma avaliação final curta.'],
      ['Reduzir slides', 'Reduza a estrutura para oito slides.']
    ];
  }
  return [
    ['Revisar roteiro', 'Revise o roteiro e a ordem dos slides.'],
    ['Melhorar o tom', 'Deixe o treinamento mais prático e profissional.'],
    ['Adicionar atividade prática', 'Adicione uma dinâmica baseada em cenário de atendimento.'],
    ['Gerar treinamento', 'O briefing está pronto. Quero gerar o treinamento.']
  ];
}

function renderMessages() {
  const data = fieldBriefing();
  const missing = missingRequired(data);
  const hasSlides = estimatedSlides(data).length >= 3;
  const chips = chipsForState(data, missing, hasSlides);
  thread.innerHTML = messages.map((message) => {
    const user = message.role === 'user';
    return `<article class="msg ${user ? 'user' : 'assistant'}">
<div class="avatar">${user ? '<i class="fas fa-user"></i>' : '3F'}</div>
<div><div class="bubble">${escapeHtml(message.content)}</div><div class="meta">${escapeHtml(message.at || '')}</div></div>
</article>`;
  }).join('') + `<div class="chips">${chips.map(([label, prompt]) => `<button class="chip" data-prompt="${escapeHtml(prompt)}"><i class="fas fa-square-plus"></i> ${escapeHtml(label)}</button>`).join('')}</div>`;
  thread.scrollTop = thread.scrollHeight;
}

function estimatedSlides(data) {
  if (draftPlan?.slides) return draftPlan.slides;
  const described = dedupeDescription(data.description).split(/\n+/).filter(Boolean);
  const fallback = described.length ? described : [
    'Contexto da operação',
    'Problema ou risco atual',
    'Indicadores impactados',
    'Conduta esperada',
    'Exemplo prático',
    'Boas práticas',
    'Atividade ou simulação',
    'Checagem de aprendizado'
  ];
  return fallback.map((title, index) => ({ title, type: index % 2 ? 'cards' : 'checklist' }));
}

function missingRequired(data) {
  const missing = [];
  if (!data.title && !data.theme) missing.push('título ou tema');
  if (!data.audience) missing.push('público-alvo');
  if (!data.objective) missing.push('objetivo');
  if (!data.duration) missing.push('duração');
  if (!data.kpiTarget && !data.behaviorChange) missing.push('KPI impactado ou comportamento esperado');
  return missing;
}

function completeness(data) {
  const keys = ['title', 'theme', 'area', 'audience', 'objective', 'duration', 'level', 'tone', 'operationType', 'kpiTarget', 'operationalPain', 'behaviorChange', 'learningEvidence', 'description'];
  const filled = keys.filter((key) => data[key]).length;
  return Math.round((filled / keys.length) * 100);
}

function renderBriefing(data) {
  const rows = [
    ['Foco', data.title || data.theme],
    ['Público-alvo', data.audience],
    ['Objetivo', data.objective],
    ['Duração', data.duration],
    ['Impacto', data.kpiTarget || data.behaviorChange],
    ['Tom', data.tone || data.level]
  ];
  briefingPanel.innerHTML = rows.map(([label, value]) => `<div class="brief-row"><span>${label}</span><button class="${value ? 'filled' : 'missing'}" data-field-label="${label}" title="Clique para corrigir ${escapeHtml(label.toLowerCase())}"><b>${escapeHtml(value || 'Ainda não informado')}</b><i class="fas ${value ? 'fa-pen' : 'fa-plus'}"></i></button></div>`).join('');
}

function renderRoute(data) {
  const slides = estimatedSlides(data);
  const descriptionText = String(data.description || '');
  slideCount.textContent = `${slides.length || 0} slides`;
  routeDuration.textContent = `Duração estimada: ${data.duration || '--'}`;
  const mainSteps = slides.slice(0, 4);
  const remaining = Math.max(0, slides.length - mainSteps.length);
  slidesPreview.innerHTML = mainSteps.length
    ? mainSteps.map((slide, index) => `<div class="slide-row"><div class="slide-num">${index + 1}</div><strong>${escapeHtml(slide.title)}</strong></div>`).join('')
    : '<div class="slide-row"><div class="slide-num">--</div><strong>Aguardando estrutura principal</strong></div>';
  if (remaining) {
    slidesPreview.innerHTML += `<div class="route-note">+ ${remaining} etapas organizadas no treinamento completo</div>`;
  }
  const flags = [
    ['Prática', data.practice || (descriptionText.toLowerCase().includes('atividade') ? 'Sim' : 'Não')],
    ['Avaliação', data.evaluation || (descriptionText.toLowerCase().includes('avalia') ? 'Sim' : 'Não')],
    ['Impacto', data.kpiTarget || data.behaviorChange ? 'Definido' : 'Pendente']
  ];
  slidesPreview.innerHTML += `<div class="flags">${flags.map(([label, value]) => `<div class="flag"><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div>`;
}

function renderStatus(data) {
  const missing = missingRequired(data);
  const percent = completeness(data);
  progressText.textContent = `Briefing ${percent}% completo`;
  briefingBar.style.width = `${percent}%`;

  if (generatedTraining?.file) {
    generateBtn.disabled = false;
    generateBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Gerar nova versão';
    generateBtn.title = 'Gerar uma nova versão a partir do briefing atual. Para ajustar o arquivo criado, use o chat.';
    statusIcon.className = 'fas fa-pen-to-square';
    statusCard.style.borderColor = 'rgba(78,165,255,.34)';
    statusTitle.style.color = 'var(--blue)';
    statusTitle.textContent = 'Modo revisão';
    statusBox.textContent = 'O treinamento ja foi criado. Use o chat para pedir ajustes no arquivo atual ou gere uma nova versão.';
    return;
  }

  generateBtn.disabled = missing.length > 0;
  generateBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Gerar treinamento';
  generateBtn.title = missing.length ? `Informe ${missing.join(', ')} para continuar.` : 'Gerar treinamento no padrão 3F.';

  statusCard.style.borderColor = missing.length ? 'rgba(240,197,90,.32)' : 'rgba(116,255,159,.28)';
  statusIcon.className = missing.length ? 'fas fa-circle-exclamation' : 'fas fa-circle-check';
  statusTitle.style.color = missing.length ? 'var(--warn)' : 'var(--green)';
  statusTitle.textContent = missing.length ? 'Faltam informações' : 'Pronto para gerar';
  statusBox.textContent = missing.length
    ? `Precisamos definir ${missing.join(', ')}.`
    : 'O briefing possui público, objetivo, duração e impacto operacional mínimo para gerar.';
}

function renderPreview() {
  const data = sanitizeBriefing(fieldBriefing());
  if (data.description !== fields.description.value.trim()) fields.description.value = data.description || '';
  renderBriefing(data);
  renderRoute(data);
  renderStatus(data);
}

async function sendChat(text) {
  messages.push(newMessage('user', text));
  renderMessages();
  statusBox.textContent = 'Analisando a conversa e atualizando o briefing...';
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ messages, briefing: fieldBriefing() })
  });
  const payload = await response.json();
  if (response.status === 401) resetAccess();
  if (!response.ok) throw new Error(payload.error || 'Falha no chat.');
  applyBriefing(payload.briefing || {});
  draftPlan = payload.draftPlan || null;
  messages.push(newMessage('assistant', payload.reply || 'Briefing atualizado.'));
  if (payload.warning) messages.push(newMessage('assistant', `Aviso: ${payload.warning}`));
  renderMessages();
  renderPreview();
}

async function reviseGeneratedTraining(text) {
  messages.push(newMessage('user', text));
  renderMessages();
  statusBox.textContent = 'Revisando o treinamento gerado e atualizando o arquivo...';
  resultBox.hidden = false;
  resultBox.className = 'result loading';
  resultBox.textContent = 'Interpretando pedido de revisão...\nAtualizando roteiro...\nReaplicando padrão visual 3F...\nSalvando treinamento...';
  const response = await fetch('/api/revise', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      instruction: text,
      plan: draftPlan,
      briefing: fieldBriefing(),
      file: generatedTraining.file
    })
  });
  const payload = await response.json();
  if (response.status === 401) resetAccess();
  if (!response.ok) throw new Error(payload.error || 'Falha ao revisar.');
  draftPlan = payload.plan;
  generatedTraining = {
    file: payload.file,
    url: payload.url,
    plan: payload.plan
  };
  renderPreview();
  const slides = payload.plan?.slides?.length || estimatedSlides(fieldBriefing()).length;
  resultBox.className = 'result';
  resultBox.innerHTML = renderResultCard({
    mode: 'updated',
    title: payload.plan.title,
    slides: `${slides} slides`,
    status: 'Pronto para nova revisão',
    url: payload.url
  });
  messages.push(newMessage('assistant', payload.reply || 'Treinamento atualizado. Você pode pedir novas alterações antes de finalizar.'));
  if (payload.warning) messages.push(newMessage('assistant', `Aviso: ${payload.warning}`));
  renderMessages();
}

async function generateTraining() {
  const data = fieldBriefing();
  const missing = missingRequired(data);
  if (missing.length) {
    statusBox.textContent = `Informe ${missing.join(', ')} para continuar.`;
    return;
  }
  generateBtn.disabled = true;
  generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando treinamento...';
  resultBox.hidden = false;
  resultBox.className = 'result loading';
  resultBox.textContent = 'Organizando briefing...\nCriando roteiro...\nGerando conteúdo...\nAplicando padrão visual 3F...';
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data)
    });
    const payload = await response.json();
    if (response.status === 401) resetAccess();
    if (!response.ok) throw new Error(payload.error || 'Falha ao gerar.');
    draftPlan = payload.plan;
    generatedTraining = {
      file: payload.file,
      url: payload.url,
      plan: payload.plan
    };
    renderPreview();
    const slides = payload.plan?.slides?.length || estimatedSlides(data).length;
    resultBox.className = 'result';
    resultBox.innerHTML = renderResultCard({
      mode: 'created',
      title: payload.plan.title,
      slides: `${slides} slides`,
      status: 'Pronto para revisão',
      url: payload.url
    });
    messages.push(newMessage('assistant', 'O treinamento foi criado. Você pode pedir alterações antes de finalizar. Sugestões: deixe mais prático, adicione uma dinâmica, reduza para oito slides ou inclua uma avaliação.'));
    renderMessages();
  } catch (error) {
    resultBox.className = 'result error';
    resultBox.textContent = `Erro: ${error.message}`;
  } finally {
    renderStatus(fieldBriefing());
  }
}

function resetConversation() {
  messages = [newMessage('assistant', openingMessage)];
  draftPlan = null;
  generatedTraining = null;
  Object.values(fields).forEach((input) => { input.value = ''; });
  resultBox.hidden = true;
  resultBox.className = 'result';
  resultBox.textContent = '';
  renderMessages();
  renderPreview();
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  try {
    if (generatedTraining?.file && draftPlan) await reviseGeneratedTraining(text);
    else await sendChat(text);
  } catch (error) {
    messages.push(newMessage('assistant', `Erro: ${error.message}`));
    renderMessages();
  }
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

thread.addEventListener('click', async (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  try {
    if (generatedTraining?.file && draftPlan) await reviseGeneratedTraining(chip.dataset.prompt);
    else await sendChat(chip.dataset.prompt);
  } catch (error) {
    messages.push(newMessage('assistant', `Erro: ${error.message}`));
    renderMessages();
  }
});

briefingPanel.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-field-label]');
  if (!button) return;
  chatInput.value = `Quero complementar o campo ${button.dataset.fieldLabel}: `;
  chatInput.focus();
});

Object.values(fields).forEach((input) => input.addEventListener('input', () => {
  draftPlan = null;
  renderPreview();
}));
generateBtn.addEventListener('click', generateTraining);
resetBtn.addEventListener('click', resetConversation);
resetTopBtn.addEventListener('click', resetConversation);
draftBtn.addEventListener('click', () => {
  resultBox.hidden = false;
  resultBox.className = 'result loading';
  resultBox.textContent = 'Atalhos: Enter envia a mensagem. Shift + Enter quebra linha. C limpa marcações nos treinamentos gerados.';
});
fullscreenBtn.addEventListener('click', async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  else await document.exitFullscreen?.();
});
sidebarCollapseBtn.addEventListener('click', () => {
  document.body.classList.toggle('sidebar-collapsed');
});
themeBtn.addEventListener('click', toggleTheme);
llmConfigBtn.addEventListener('click', openLlmModal);
llmCloseBtn.addEventListener('click', closeLlmModal);
llmCancelBtn.addEventListener('click', closeLlmModal);
llmSlot.addEventListener('change', () => renderLlmConfig(llmSlot.value));
llmApiUrl.addEventListener('input', refreshModelsUrlPreview);
llmApiUrl.addEventListener('change', () => {
  refreshModelsUrlPreview();
  setModelOptions(suggestedModels(llmApiUrl.value), selectedModelValue());
});
llmModel.addEventListener('change', () => {
  llmCustomModelWrap.hidden = llmModel.value !== '__custom';
  if (llmModel.value === '__custom') llmCustomModel.focus();
});
llmNewApiBtn.addEventListener('click', prepareNewApiSlot);
llmLoadModelsBtn.addEventListener('click', loadAvailableModels);
llmForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveLlmConfig();
});
accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  accessError.textContent = '';
  const key = accessKeyInput.value.trim();
  if (!key) return;
  const button = accessForm.querySelector('button');
  button.disabled = true;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Validando...';
  try {
    const result = await validateAccessKey(key);
    if (!result.ok) {
      accessError.textContent = result.reason;
      return;
    }
    generatorKey = key;
    sessionStorage.setItem('3f-generator-key', key);
    accessGate.hidden = true;
  } catch (error) {
    accessError.textContent = `Falha ao validar: ${error.message}`;
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-key"></i> Validar chave';
  }
});

loadRuntimeConfig().then(() => {
  setTheme(localStorage.getItem('3f-theme') || 'dark');
  renderMessages();
  renderPreview();
  ensureAccess();
});
