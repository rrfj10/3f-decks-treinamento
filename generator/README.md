# Gerador de Treinamentos 3F

Frontend conversacional e API local para criar decks HTML no padrão visual dos treinamentos 3F.

## Rodar localmente

Na raiz do projeto:

```bash
npm run dev:generator
```

Abrir:

```text
http://localhost:3000
```

Com Docker Compose:

```bash
docker compose up -d
```

Abrir:

```text
http://localhost:8091
```

Chave padrão local do gerador:

```text
3f-treinamentos-local
```

O Docker Compose lê o arquivo `.env` da raiz do projeto. Para configurar localmente:

```bash
cp .env.example .env
```

Depois ajuste:

```text
GENERATOR_API_KEY=<sua-chave-local>
```

Em produção/Portainer, troque por uma chave forte:

```text
GENERATOR_API_KEY=<chave-forte-do-gerador>
```

`GENERATOR_API_KEY` não tem valor padrão: o Compose falha se ela não estiver
definida. Tentativas de validação são limitadas a 10 por minuto por IP.

## LLM

Sem chave, o gerador usa fallback local.

Para chamar uma LLM compatível com Chat Completions:

```text
LLM_API_KEY=<sua-chave>
LLM_MODEL=gpt-4.1-mini
LLM_API_URL=https://api.openai.com/v1/chat/completions
```

Também aceita:

```text
OPENAI_API_KEY=<sua-chave>
```

### Hosts autorizados

A `LLM_API_URL` só pode apontar para um host da allowlist — caso contrário a chave
da LLM poderia ser enviada, no header `Authorization`, para um destino arbitrário.
Padrão: `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`,
`openrouter.ai`, `api.groq.com`, `api.deepseek.com`, `api.mistral.ai`, `api.cohere.com`.

Para liberar outro provedor (ou uma LLM local):

```text
LLM_ALLOWED_HOSTS=api.openai.com,localhost
LLM_TIMEOUT_MS=60000
```

Só `https://` é aceito; `http://` apenas para `localhost`/`127.0.0.1`.

## Testes

```bash
npm test
```

## Configurar LLM pela tela

No gerador, clique no botão com ícone de plug na barra superior.

A tela permite configurar até 5 APIs:

- nome do slot;
- chave da API;
- modelo;
- URL compatível com Chat Completions.

Ao salvar, o backend atualiza o `.env` local e ativa o slot escolhido. A chave não é exibida novamente na tela.

## Saída

O gerador salva:

- HTML em `treinamentos/decks/<area>/<titulo>_vN.html`
- Registro em `treinamentos/catalog.json`, com a marca `"generated": true`

O catálogo publicado em Nginx lê `catalog.json`, então novos treinamentos aparecem na tela principal.

### Proteção dos decks autorais

`/api/revise` reescreve o arquivo por inteiro. Por isso só aceita decks cuja
entrada no catálogo tenha `"generated": true`. Decks montados à mão a partir de
`treinamentos/_template/base-template.html` não têm essa marca e são recusados
com HTTP 403 — não adicione a marca a eles.

## Fluxo v2

1. O usuário conversa com o assistente para refinar o briefing.
2. A tela mantém campos estruturados: título, área, público, objetivo e tópicos.
3. A prévia lateral mostra o roteiro estimado.
4. Ao clicar em **Gerar treinamento**, a API renderiza o HTML no padrão 3F.

A conversa não substitui o schema. Ela serve para preparar os dados que entram no renderizador.
