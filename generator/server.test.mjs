import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GENERATOR_REQUIRE_AUTH = 'false';
process.env.LLM_ALLOWED_HOSTS = 'api.openai.com,localhost';

const {
  RequestError,
  addRevisionSlides,
  assertAllowedLlmUrl,
  esc,
  extractBriefingFromMessages,
  fallbackPlan,
  normalizePlan,
  parseEnv,
  renderDeck,
  requestedSlideCount,
  resolveDeckFile,
  serializeEnv,
  slugify,
  text,
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
