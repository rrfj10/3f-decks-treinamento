import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GENERATOR_REQUIRE_AUTH = 'false';
process.env.LLM_ALLOWED_HOSTS = 'api.openai.com,localhost';

const {
  RequestError,
  addRevisionSlides,
  assertAllowedLlmUrl,
  coverTitleHtml,
  dedupeLines,
  esc,
  extractBriefingFromMessages,
  fallbackPlan,
  normalizePlan,
  parseEnv,
  renderDeck,
  requestedSlideCount,
  resolveDeckFile,
  reusableSlotKey,
  serializeEnv,
  slugify,
  stripListMarker,
  text,
  truncated,
  withSlideLimit
} = await import('./server.mjs');

test('normalizePlan sobrevive a slides invalidos vindos da LLM', () => {
  const plan = normalizePlan({ title: 'X', slides: [null, 'texto', 42, { type: 'cards' }] });
  assert.equal(plan.slides.every((slide) => typeof slide.title === 'string'), true);
  assert.equal(plan.slides[0].type, 'cover');
  assert.equal(plan.slides.at(-1).type, 'closing');
});

test('normalizePlan aceita rows que nao sao arrays sem quebrar o render', () => {
  const plan = normalizePlan({ title: 'X', slides: [{ type: 'table', title: 'T', rows: ['a', ['b', 'c']] }] });
  const table = plan.slides.find((slide) => slide.type === 'table');
  assert.deepEqual(table.rows, [['a'], ['b', 'c']]);
  assert.doesNotThrow(() => renderDeck(plan));
});

test('normalizePlan tolera entrada que nao e objeto', () => {
  for (const input of [null, undefined, 'texto', 7, []]) {
    const plan = normalizePlan(input);
    assert.equal(plan.title, 'Novo Treinamento');
    assert.equal(plan.slides.length, 2);
  }
});

test('normalizePlan nao deixa objeto virar "[object Object]"', () => {
  const plan = normalizePlan({ title: { nested: true }, slides: [] });
  assert.equal(plan.title, 'Novo Treinamento');
});

test('fallbackPlan aceita briefing com tipos errados', () => {
  assert.doesNotThrow(() => fallbackPlan({ title: 12, description: ['a'], objective: null }));
  assert.doesNotThrow(() => fallbackPlan(null));
});

test('renderDeck escapa HTML do conteudo', () => {
  const html = renderDeck(normalizePlan({
    title: '<img src=x onerror=alert(1)>',
    slides: [{ type: 'cards', title: 'A', items: [{ title: '"><script>', text: "aspas ' simples" }] }]
  }));
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('"><script>'), false);
  assert.equal(html.includes('&#39;'), true);
});

test('renderDeck preserva controles do template mestre', () => {
  const html = renderDeck(normalizePlan({
    title: 'Controles',
    slides: [{ type: 'cover', title: 'Controles', lead: 'Notas do instrutor' }]
  }));
  assert.match(html, /class="navigation"/);
  assert.match(html, /onclick="nextSlide\(\)"/);
  assert.match(html, /id="shortcutsModal"/);
  assert.match(html, /toggleShortcuts/);
  assert.match(html, /id="instructorPanel"/);
  assert.match(html, /toggleInstructor/);
  assert.match(html, /id="ipNotes"/);
  assert.match(html, /data-notes="Notas do instrutor"/);
});

test('renderDeck gera graficos visuais nativos', () => {
  const html = renderDeck(normalizePlan({
    title: 'Graficos',
    slides: [
      {
        type: 'chart-bar',
        title: 'Barras',
        chart: { labels: ['TMA', 'SLA'], unit: '%', series: [{ name: 'Atual', values: [8.5, 82] }, { name: 'Meta', values: [6, 90] }] }
      },
      {
        type: 'chart-line',
        title: 'Linha',
        chart: { labels: ['S1', 'S2', 'S3'], unit: '%', series: [{ name: 'SLA', values: [80, 84, 88] }] }
      },
      {
        type: 'chart-pie',
        title: 'Pizza',
        chart: { labels: ['A', 'B'], series: [{ name: 'Share', values: [60, 40] }] }
      },
      {
        type: 'chart-funnel',
        title: 'Funil',
        chart: { labels: ['Entradas', 'Tratadas'], series: [{ name: 'Volume', values: [1000, 740] }] }
      },
      {
        type: 'decision-tree',
        title: 'Arvore',
        items: [{ title: 'Fora da meta?', text: 'Sim ou nao' }, { title: 'Acionar', text: 'Plano de acao' }]
      }
    ]
  }));
  assert.match(html, /chart-panel chart-bars/);
  assert.match(html, /class="line-chart"/);
  assert.match(html, /class="pie-chart"/);
  assert.match(html, /class="chart-panel funnel-chart"/);
  assert.match(html, /class="decision-tree"/);
  assert.equal(html.includes('Gráfico de barras (simulado)'), false);
});

test('fallbackPlan cria slide visual quando briefing pede grafico', () => {
  const plan = fallbackPlan({
    title: 'Grafico de SLA',
    audience: 'supervisores',
    objective: 'interpretar linha de tendencia',
    duration: '15 minutos',
    description: 'linha de tendencia semanal: semana 1 80%, semana 2 84%, semana 3 88%'
  });
  assert.equal(plan.slides.some((slide) => slide.type === 'chart-line'), true);
  assert.doesNotThrow(() => renderDeck(plan));
});

test('renderDeck gera padroes visuais de infografico', () => {
  const html = renderDeck(normalizePlan({
    title: 'Infograficos',
    slides: [
      { type: 'metric-donut', title: 'Resultados', items: [{ title: 'Satisfacao', text: '67%' }] },
      { type: 'kpi-row', title: 'KPIs', items: [{ icon: 'fa-gauge-high', title: 'Avaliacoes', text: '105' }] },
      { type: 'infographic-timeline', title: 'Timeline', items: [{ title: 'Inicio', text: 'Diagnostico' }, { title: 'Fim', text: 'Medicao' }] },
      { type: 'radial-steps', title: 'Etapas', items: [{ title: 'Ler', text: 'Indicador' }, { title: 'Agir', text: 'Plano' }] },
      { type: 'process-map', title: 'Processo', items: [{ title: 'Entrada', text: 'Demanda' }, { title: 'Saida', text: 'Evidencia' }] },
      { type: 'icon-columns', title: 'Quem somos', items: [{ icon: 'fa-bullseye', title: 'Missao', text: 'Entregar valor' }] },
      { type: 'pricing-table', title: 'Planos', items: [{ title: 'Plano Basico', text: 'R$ 500,00; Relatorio; Suporte' }] },
      { type: 'objective-board', title: 'Objetivos', items: [{ title: 'Expandir presenca', text: 'No mercado' }] },
      { type: 'performance-summary', title: 'Desempenho', items: [{ title: 'Performance', text: '90%' }] }
    ]
  }));
  assert.match(html, /class="metric-donut-grid"/);
  assert.match(html, /class="kpi-row-visual"/);
  assert.match(html, /class="infographic-timeline"/);
  assert.match(html, /class="radial-steps"/);
  assert.match(html, /class="process-map-visual"/);
  assert.match(html, /class="icon-columns-visual"/);
  assert.match(html, /class="pricing-grid"/);
  assert.match(html, /class="objective-board"/);
  assert.match(html, /class="performance-summary"/);
});

test('fallbackPlan cria padrao visual quando briefing pede infografico', () => {
  const plan = fallbackPlan({
    title: 'Resultados em numeros',
    audience: 'lideranca',
    objective: 'mostrar um dashboard visual com numeros e objetivos',
    description: 'quero um infografico premium com resultados em numeros e metas'
  });
  assert.equal(plan.slides.some((slide) => ['metric-donut', 'kpi-row', 'objective-board', 'performance-summary'].includes(slide.type)), true);
  assert.doesNotThrow(() => renderDeck(plan));
});

test('esc cobre aspas simples', () => {
  assert.equal(esc(`<a href='x'>&"`), '&lt;a href=&#39;x&#39;&gt;&amp;&quot;');
});

test('text rejeita objetos e arrays', () => {
  assert.equal(text({ a: 1 }, 'fb'), 'fb');
  assert.equal(text(['a'], 'fb'), 'fb');
  assert.equal(text('  ok  '), 'ok');
  assert.equal(text(3), '3');
});

test('assertAllowedLlmUrl bloqueia host fora da allowlist', () => {
  assert.throws(() => assertAllowedLlmUrl('https://evil.example.com/v1'), RequestError);
  assert.throws(() => assertAllowedLlmUrl('http://api.openai.com/v1'), RequestError);
  assert.throws(() => assertAllowedLlmUrl('nao-e-url'), RequestError);
  assert.equal(assertAllowedLlmUrl('https://api.openai.com/v1/chat/completions').startsWith('https://api.openai.com'), true);
  assert.equal(assertAllowedLlmUrl('http://localhost:11434/v1').startsWith('http://localhost'), true);
});

test('resolveDeckFile impede saida da pasta de decks', () => {
  assert.throws(() => resolveDeckFile('../../etc/passwd.html'), RequestError);
  assert.throws(() => resolveDeckFile('catalog.json'), RequestError);
  assert.throws(() => resolveDeckFile('decks/x/../../../fora.html'), RequestError);
  assert.throws(() => resolveDeckFile(''), RequestError);
  assert.equal(resolveDeckFile('/decks/rh/a.html').relFile, 'decks/rh/a.html');
});

test('serializeEnv preserva comentarios e ordem do arquivo original', () => {
  const original = '# comentario\nA=1\n\n# outro\nB=2\n';
  const output = serializeEnv({ A: '9', B: '2', C: '3' }, original);
  assert.equal(output, '# comentario\nA=9\n\n# outro\nB=2\nC=3\n');
  assert.deepEqual(parseEnv(output), { A: '9', B: '2', C: '3' });
});

test('serializeEnv remove chaves ausentes no novo conjunto', () => {
  assert.equal(serializeEnv({ A: '1' }, 'A=1\nB=2\n'), 'A=1\n');
});

test('parseEnv mantem sinais de igual no valor', () => {
  assert.deepEqual(parseEnv('K=a=b=c\n#x=1\nsemigual\n'), { K: 'a=b=c' });
});

test('slugify normaliza acentos e limita tamanho', () => {
  assert.equal(slugify('Ação & Reação!'), 'acao-reacao');
  assert.equal(slugify(''), 'treinamento');
  assert.equal(slugify('a'.repeat(200)).length, 72);
});

test('slugify nao deixa hifen sobrando na ponta depois do corte', () => {
  // 72 caracteres exatos terminando no separador: aparar antes do slice deixava
  // o hifen final e o arquivo virava "...-_v1.html".
  const slug = slugify(`${'a'.repeat(71)} palavra cortada`);
  assert.equal(slug.length <= 72, true);
  assert.equal(slug.endsWith('-'), false);
  assert.equal(slugify('  espacos nas pontas  ').startsWith('-'), false);
});

test('requestedSlideCount extrai e limita o alvo', () => {
  assert.equal(requestedSlideCount('reduza para 8 slides'), 8);
  assert.equal(requestedSlideCount('quero 99 slides'), 24);
  assert.equal(requestedSlideCount('quero 1 slide'), 3);
  assert.equal(requestedSlideCount('sem numero'), 0);
});

test('addRevisionSlides insere no fim quando nao existe encerramento', () => {
  const base = { ...normalizePlan({ title: 'T', slides: [{ type: 'cover', title: 'T' }] }) };
  base.slides = base.slides.filter((slide) => slide.type !== 'closing');
  const revised = addRevisionSlides(base, 'inclua uma dinâmica', {});
  const capaIndex = revised.slides.findIndex((slide) => slide.type === 'cover');
  const atividadeIndex = revised.slides.findIndex((slide) => slide.title === 'Atividade prática');
  assert.equal(capaIndex, 0);
  assert.equal(atividadeIndex > capaIndex, true);
});

test('addRevisionSlides insere antes do encerramento quando ele existe', () => {
  const plan = normalizePlan({ title: 'T', slides: [{ type: 'cover', title: 'T' }, { type: 'closing', title: 'Fim' }] });
  const revised = addRevisionSlides(plan, 'inclua uma avaliação', {});
  assert.equal(revised.slides.at(-1).type, 'closing');
  assert.equal(revised.slides.some((slide) => slide.title === 'Avaliação final'), true);
});

test('withSlideLimit nao duplica o slide unico', () => {
  const plan = normalizePlan({ title: 'T', slides: [{ type: 'cover', title: 'T' }] });
  plan.slides = [plan.slides[0]];
  const limited = withSlideLimit(plan, 3);
  assert.equal(new Set(limited.slides.map((slide) => slide.title)).size, limited.slides.length);
});

test('normalizePlan mantem o encerramento ao bater no limite de slides', () => {
  const slides = [
    { type: 'cover', title: 'Capa' },
    ...Array.from({ length: 30 }, (_, index) => ({ type: 'cards', title: `S${index}` }))
  ];
  const plan = normalizePlan({ title: 'T', slides });
  assert.equal(plan.slides.length, 24);
  assert.equal(plan.slides[0].type, 'cover');
  assert.equal(plan.slides.at(-1).type, 'closing');
});

test('normalizePlan nao adiciona encerramento duplicado quando ja existe', () => {
  const slides = [
    { type: 'cover', title: 'Capa' },
    ...Array.from({ length: 30 }, (_, index) => ({ type: 'cards', title: `S${index}` })),
    { type: 'closing', title: 'Fim' }
  ];
  const plan = normalizePlan({ title: 'T', slides });
  assert.equal(plan.slides.length, 24);
  assert.equal(plan.slides.filter((slide) => slide.type === 'closing').length, 1);
});

test('normalizePlan remove encerramento duplicado no meio do plano', () => {
  const plan = normalizePlan({
    title: 'T',
    slides: [
      { type: 'cover', title: 'Capa' },
      { type: 'closing', title: 'Fim prematuro' },
      { type: 'chart-bar', title: 'Grafico', chart: { labels: ['A'], series: [{ name: 'Valor', values: [1] }] } },
      { type: 'closing', title: 'Fim correto' }
    ]
  });
  assert.equal(plan.slides.filter((slide) => slide.type === 'closing').length, 1);
  assert.equal(plan.slides.at(-1).title, 'Fim correto');
});

test('coverTitleHtml fecha o span com varios hifens no titulo', () => {
  assert.equal(coverTitleHtml('A - B - C'), 'A<br><span class="gradient-title">B - C</span>');
  assert.equal(coverTitleHtml('Sem hifen'), 'Sem hifen');
  const html = coverTitleHtml('<img> - x');
  assert.equal(html.includes('<img>'), false);
  assert.equal((html.match(/<span/g) || []).length, (html.match(/<\/span>/g) || []).length);
});

test('truncated corta o texto cru sem quebrar entidade HTML', () => {
  const label = truncated('aaaaaaaaaaaaaaaaaaaa&&&b', 22);
  assert.equal(label.includes('&a<'), false);
  assert.equal(label.includes('&amp;'), true);
  assert.equal(truncated('curto', 22), 'curto');
});

test('stripListMarker remove marcador sem comer numero decimal', () => {
  assert.equal(stripListMarker('3.5 minutos de TMA'), '3.5 minutos de TMA');
  assert.equal(stripListMarker('- Contexto'), 'Contexto');
  assert.equal(stripListMarker('1. Contexto'), 'Contexto');
  assert.equal(stripListMarker('2) Contexto'), 'Contexto');
  assert.equal(dedupeLines('3.5 minutos de TMA'), '3.5 minutos de TMA');
});

test('reusableSlotKey so devolve a chave para o host que ela atende', () => {
  const envValues = {
    LLM_SLOT_1_API_KEY: 'sk-openai',
    LLM_SLOT_1_API_URL: 'https://api.openai.com/v1/chat/completions'
  };
  assert.equal(reusableSlotKey(envValues, 1, 'https://api.openai.com/v1/chat/completions'), 'sk-openai');
  assert.throws(
    () => reusableSlotKey(envValues, 1, 'https://openrouter.ai/api/v1/chat/completions'),
    RequestError
  );
  assert.equal(reusableSlotKey({}, 1, 'https://api.openai.com/v1'), '');
});

test('extractBriefingFromMessages le rotulos e ignora mensagens invalidas', () => {
  const briefing = extractBriefingFromMessages([
    { role: 'user', content: 'Título: Gestão de fila\nPúblico: supervisores\nKPI: TME' },
    { role: 'user', content: 'Objetivo: reduzir espera' }
  ], {});
  assert.equal(briefing.title, 'Gestão de fila');
  assert.equal(briefing.audience, 'supervisores');
  assert.equal(briefing.kpiTarget, 'TME');
  assert.equal(briefing.objective, 'reduzir espera');
});
