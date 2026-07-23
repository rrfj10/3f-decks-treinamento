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
const statusBox = document.getElementById('statusBox');
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
  description: document.getElementById('description')
};

let messages = [
  {
    role: 'assistant',
    content: 'Qual treinamento você quer criar? Me diga o tema, o público e o principal objetivo.'
  }
];
let briefing = {};
let draftPlan = null;
let authRequired = false;
let generatorKey = sessionStorage.getItem('3f-generator-key') || '';

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

async function validateAccessKey(key) {
  if (!authRequired) return true;
  const response = await fetch('/api/validate-key', {
    method: 'POST',
    headers: { 'X-API-Key': key }
  });
  return response.ok;
}

async function ensureAccess() {
  if (!authRequired) {
    accessGate.hidden = true;
    return true;
  }
  if (generatorKey && await validateAccessKey(generatorKey)) {
    accessGate.hidden = true;
    return true;
  }
  generatorKey = '';
  sessionStorage.removeItem('3f-generator-key');
  accessGate.hidden = false;
  accessKeyInput.focus();
  return false;
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

function nowTime() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function fieldBriefing() {
  return Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
}

function applyBriefing(next) {
  briefing = { ...briefing, ...next };
  for (const [key, input] of Object.entries(fields)) {
    if (briefing[key] != null && briefing[key] !== input.value) input.value = briefing[key];
  }
}

function chipsForState(data, missing, hasSlides) {
  if (!messages.some((message) => message.role === 'user')) {
    return [
      ['Organizar em slides', 'Me ajude a organizar esses tópicos em slides.'],
      ['Sugerir estrutura', 'Sugira uma estrutura com capa, módulos e encerramento.'],
      ['Ver informações necessárias', 'Quais informações você precisa para criar um bom treinamento?'],
      ['Criar treinamento rápido', 'Quero criar um treinamento rápido. Me faça as perguntas essenciais.']
    ];
  }
  if (missing.length) {
    return [
      ['Ver informações faltantes', 'Quais informações ainda faltam?'],
      ['Melhorar objetivo', 'Me ajude a melhorar o objetivo do treinamento.'],
      ['Definir público', 'Me ajude a definir o público-alvo.'],
      ['Sugerir duração', 'Sugira uma duração adequada para esse treinamento.']
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
    ['Adicionar atividade prática', 'Adicione uma dinâmica em grupo.'],
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
<div><div class="bubble">${escapeHtml(message.content)}</div><div class="meta">${nowTime()}</div></div>
</article>`;
  }).join('') + `<div class="chips">${chips.map(([label, prompt]) => `<button class="chip" data-prompt="${escapeHtml(prompt)}"><i class="fas fa-square-plus"></i> ${escapeHtml(label)}</button>`).join('')}</div>`;
  thread.scrollTop = thread.scrollHeight;
}

function estimatedSlides(data) {
  return draftPlan?.slides || data.description.split(/\n+/).map((line) => line.replace(/^[-*\d. )]+/, '').trim()).filter(Boolean).map((title, index) => ({ title, type: index % 2 ? 'cards' : 'checklist' }));
}

function missingRequired(data) {
  const missing = [];
  if (!data.title) missing.push('título');
  if (!data.audience) missing.push('público-alvo');
  if (!data.objective) missing.push('objetivo');
  if (!data.duration) missing.push('duração');
  if (estimatedSlides(data).length < 3) missing.push('ao menos 3 tópicos');
  return missing;
}

function completeness(data) {
  const keys = ['title', 'theme', 'area', 'audience', 'objective', 'duration', 'level', 'tone', 'description'];
  const filled = keys.filter((key) => data[key]).length;
  return Math.round((filled / keys.length) * 100);
}

function renderBriefing(data) {
  const rows = [
    ['Título', data.title],
    ['Tema', data.theme],
    ['Área', data.area],
    ['Público-alvo', data.audience],
    ['Objetivo', data.objective],
    ['Duração', data.duration],
    ['Nível', data.level],
    ['Tom', data.tone]
  ];
  briefingPanel.innerHTML = rows.map(([label, value]) => `<div class="brief-row"><span>${label}</span><button class="${value ? '' : 'missing'}" data-field-label="${label}">${escapeHtml(value || 'Ainda não informado')}</button></div>`).join('');
}

function renderRoute(data) {
  const slides = estimatedSlides(data);
  slideCount.textContent = `${slides.length || 0} slides`;
  routeDuration.textContent = `Duração estimada: ${data.duration || '--'}`;
  slidesPreview.innerHTML = slides.length ? slides.slice(0, 10).map((slide, index) => `<div class="slide-row"><div class="slide-num">${index + 1}</div><strong>${escapeHtml(slide.title)}</strong></div>`).join('') : '<div class="slide-row"><div class="slide-num">--</div><strong>Aguardando tópicos do treinamento</strong></div>';
  const flags = [
    ['Atividade prática', data.practice || (data.description.toLowerCase().includes('atividade') ? 'Sim' : 'Não')],
    ['Avaliação', data.evaluation || (data.description.toLowerCase().includes('avalia') ? 'Sim' : 'Não')],
    ['Exemplos', data.description.toLowerCase().includes('exemplo') ? 'Sim' : 'Não']
  ];
  slidesPreview.innerHTML += `<div class="flags">${flags.map(([label, value]) => `<div class="flag"><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div>`;
}

function renderStatus(data) {
  const missing = missingRequired(data);
  const percent = completeness(data);
  progressText.textContent = `Briefing ${percent}% completo`;
  briefingBar.style.width = `${percent}%`;
  generateBtn.disabled = missing.length > 0;
  generateBtn.title = missing.length ? `Informe ${missing.join(', ')} para continuar.` : 'Gerar treinamento no padrão 3F.';

  statusCard.style.borderColor = missing.length ? 'rgba(240,197,90,.32)' : 'rgba(116,255,159,.28)';
  statusTitle.style.color = missing.length ? 'var(--warn)' : 'var(--green)';
  statusTitle.textContent = missing.length ? 'Faltam informações' : 'Pronto para gerar';
  statusBox.textContent = missing.length
    ? `Precisamos definir ${missing.join(', ')}.`
    : 'O briefing e o roteiro possuem as informações necessárias.';
}

function renderPreview() {
  const data = fieldBriefing();
  renderBriefing(data);
  renderRoute(data);
  renderStatus(data);
}

async function sendChat(text) {
  messages.push({ role: 'user', content: text });
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
  messages.push({ role: 'assistant', content: payload.reply || 'Briefing atualizado.' });
  if (payload.warning) messages.push({ role: 'assistant', content: `Aviso: ${payload.warning}` });
  renderMessages();
  renderPreview();
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
    renderPreview();
    const slides = payload.plan?.slides?.length || estimatedSlides(data).length;
    resultBox.innerHTML = `<strong>Treinamento criado com sucesso</strong><br>${escapeHtml(payload.plan.title)}<br>${slides} slides · criado em ${todayPtBr()} · status: pronto para revisão<br><br><a href="${catalogBase}${payload.url}" target="_blank">Abrir treinamento</a> · <a href="${catalogBase}" target="_blank">Voltar ao catálogo</a>`;
    messages.push({ role: 'assistant', content: 'O treinamento foi criado. Você pode pedir alterações antes de finalizar.' });
    renderMessages();
  } catch (error) {
    resultBox.textContent = `Erro: ${error.message}`;
  } finally {
    generateBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Gerar treinamento';
    generateBtn.disabled = missingRequired(fieldBriefing()).length > 0;
  }
}

function resetConversation() {
  messages = [{ role: 'assistant', content: 'Qual treinamento você quer criar? Me diga o tema, o público e o principal objetivo.' }];
  briefing = {};
  draftPlan = null;
  Object.values(fields).forEach((input) => { input.value = ''; });
  resultBox.hidden = true;
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
    await sendChat(text);
  } catch (error) {
    messages.push({ role: 'assistant', content: `Erro: ${error.message}` });
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
    await sendChat(chip.dataset.prompt);
  } catch (error) {
    messages.push({ role: 'assistant', content: `Erro: ${error.message}` });
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
accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  accessError.textContent = '';
  const key = accessKeyInput.value.trim();
  if (!key) return;
  const button = accessForm.querySelector('button');
  button.disabled = true;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Validando...';
  try {
    if (!await validateAccessKey(key)) {
      accessError.textContent = 'Chave invalida. Verifique e tente novamente.';
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
