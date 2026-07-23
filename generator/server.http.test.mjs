import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Este arquivo cobre a camada HTTP com autenticacao LIGADA. Precisa rodar em um
// processo separado do server.test.mjs porque server.mjs le a configuracao uma
// unica vez, no import - o node --test ja executa cada arquivo isolado.
const apiKey = 'chave-de-teste-123';
process.env.GENERATOR_REQUIRE_AUTH = 'true';
process.env.GENERATOR_API_KEY = apiKey;
process.env.MAX_BODY_BYTES = '2048';
// Fixado para o teste nao depender do .env da maquina de quem roda a suite.
process.env.CATALOG_BASE_URL = 'http://catalogo.teste';
// TRUST_PROXY ligado da a cada teste um IP proprio via x-forwarded-for, entao o
// balde de tentativas de um teste nao trava os seguintes - e de quebra exercita o
// caminho de proxy reverso, que e como o gerador roda atras do nginx.
process.env.TRUST_PROXY = 'true';
process.env.TRAINING_ROOT = await mkdtemp(path.join(tmpdir(), '3f-treinamentos-test-'));

const { server } = await import('./server.mjs');

let baseUrl = '';
let listening = false;

before(async () => {
  await mkdir(path.join(process.env.TRAINING_ROOT, 'decks'), { recursive: true });
  await writeFile(
    path.join(process.env.TRAINING_ROOT, 'catalog.json'),
    JSON.stringify({ trainings: [] })
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      listening = true;
      resolve();
    });
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!listening) return;
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

let ipCounter = 0;
/** IP fake exclusivo por teste, para isolar o limite de tentativas. */
const freshIp = () => `10.0.0.${(ipCounter += 1)}`;

const call = (pathname, options = {}, ip = freshIp()) =>
  fetch(`${baseUrl}${pathname}`, { ...options, headers: { ...options.headers, 'x-forwarded-for': ip } });
const withKey = (key = apiKey) => ({ 'x-api-key': key, 'content-type': 'application/json' });

test('endpoints protegidos recusam requisicao sem chave', async () => {
  for (const [method, pathname] of [['GET', '/api/llm-config'], ['POST', '/api/generate'], ['POST', '/api/revise']]) {
    const response = await call(pathname, { method, body: method === 'POST' ? '{}' : undefined });
    assert.equal(response.status, 401, `${method} ${pathname}`);
    assert.match((await response.json()).error, /chave/i);
  }
});

test('chave errada nao passa e chave certa passa', async () => {
  const bad = await call('/api/validate-key', { method: 'POST', headers: withKey('errada') });
  assert.equal(bad.status, 401);

  const good = await call('/api/validate-key', { method: 'POST', headers: withKey() });
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { ok: true });
});

test('excesso de tentativas erradas devolve 429 e nao vira oraculo de forca bruta', async () => {
  const atacante = freshIp();
  let sawThrottle = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await call('/api/validate-key', { method: 'POST', headers: withKey(`errada-${attempt}`) }, atacante);
    if (response.status === 429) {
      sawThrottle = true;
      break;
    }
    assert.equal(response.status, 401);
  }
  assert.equal(sawThrottle, true, 'esperava 429 antes da 12a tentativa');

  // Enquanto o balde do atacante esta cheio, nem a chave correta passa daquele IP.
  const blocked = await call('/api/validate-key', { method: 'POST', headers: withKey() }, atacante);
  assert.equal(blocked.status, 429);

  // Mas outro IP segue atendido: o bloqueio e por origem, nao global. Sem
  // TRUST_PROXY, atras do nginx todos cairiam no mesmo balde e um atacante
  // trancaria a operacao inteira.
  const outro = await call('/api/validate-key', { method: 'POST', headers: withKey() });
  assert.equal(outro.status, 200);
});

test('catalogo e config seguem publicos', async () => {
  const catalog = await call('/api/catalog');
  assert.equal(catalog.status, 200);
  assert.deepEqual(await catalog.json(), { trainings: [] });

  const config = await call('/api/config');
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), { catalogBaseUrl: 'http://catalogo.teste', authRequired: true });
});

test('corpo acima do limite responde 413 em JSON, sem derrubar a conexao', async () => {
  const response = await call('/api/chat', {
    method: 'POST',
    headers: withKey(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(5000) }] })
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /grande/i);
});

test('corpo que nao e JSON de objeto responde 400', async () => {
  for (const body of ['nao-e-json', '"texto"', '[1,2]']) {
    const response = await call('/api/chat', { method: 'POST', headers: withKey(), body });
    assert.equal(response.status, 400, body);
  }
});

test('estatico barra travessia de diretorio e responde 404 para arquivo ausente', async () => {
  const traversal = await call('/../../server.mjs');
  assert.equal([403, 404].includes(traversal.status), true);

  const encoded = await call('/%2e%2e%2f%2e%2e%2fserver.mjs');
  assert.equal([403, 404].includes(encoded.status), true);

  const missing = await call('/nao-existe.html');
  assert.equal(missing.status, 404);
});

test('estatico serve a interface com os headers de seguranca', async () => {
  const response = await call('/index.html');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-type'), /text\/html/);
});

test('CSP bloqueia script de terceiro e libera a origem do catalogo para imagem', async () => {
  const csp = (await call('/index.html')).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.equal(csp.includes("script-src 'self' 'unsafe-inline'"), false);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  // catalogBaseUrl vira origem liberada em img-src, senao as logos nao carregam.
  assert.match(csp, /img-src 'self' data: http:\/\/catalogo\.teste/);
});

test('resposta de API tambem carrega os headers de seguranca', async () => {
  const response = await call('/api/catalog');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('revisao recusa arquivo fora de decks e deck ausente do catalogo', async () => {
  const outside = await call('/api/revise', {
    method: 'POST',
    headers: withKey(),
    body: JSON.stringify({ instruction: 'mude', file: '../catalog.json' })
  });
  assert.equal(outside.status, 400);

  const unknown = await call('/api/revise', {
    method: 'POST',
    headers: withKey(),
    body: JSON.stringify({ instruction: 'mude', file: 'decks/rh/inexistente.html' })
  });
  assert.equal(unknown.status, 404);
});

test('revisao sem o plano atual e recusada em vez de sobrescrever o deck', async () => {
  const relFile = 'decks/rh/gerado.html';
  const original = '<html>conteudo original</html>';
  await mkdir(path.join(process.env.TRAINING_ROOT, 'decks', 'rh'), { recursive: true });
  await writeFile(path.join(process.env.TRAINING_ROOT, relFile), original);
  await writeFile(
    path.join(process.env.TRAINING_ROOT, 'catalog.json'),
    JSON.stringify({ trainings: [{ title: 'Gerado', area: 'rh', file: relFile, version: 'v2', generated: true }] })
  );

  for (const body of [{}, { plan: null }, { plan: {} }, { plan: { slides: [] } }]) {
    const response = await call('/api/revise', {
      method: 'POST',
      headers: withKey(),
      body: JSON.stringify({ instruction: 'reduza para 5 slides', file: relFile, ...body })
    });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).error, /plano atual/i);
  }

  // O deck precisa continuar intacto depois das tentativas recusadas.
  assert.equal(await readFile(path.join(process.env.TRAINING_ROOT, relFile), 'utf8'), original);
});

test('revisao nao sobrescreve deck autoral (sem generated: true)', async () => {
  const relFile = 'decks/rh/autoral.html';
  await mkdir(path.join(process.env.TRAINING_ROOT, 'decks', 'rh'), { recursive: true });
  await writeFile(path.join(process.env.TRAINING_ROOT, relFile), '<html>feito a mao</html>');
  await writeFile(
    path.join(process.env.TRAINING_ROOT, 'catalog.json'),
    JSON.stringify({ trainings: [{ title: 'Autoral', area: 'rh', file: relFile, version: 'v1' }] })
  );

  const response = await call('/api/revise', {
    method: 'POST',
    headers: withKey(),
    body: JSON.stringify({ instruction: 'reduza para 5 slides', file: relFile })
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /nao foi criado pelo gerador|não foi criado pelo gerador/i);
});
