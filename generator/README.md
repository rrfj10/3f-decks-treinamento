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

## Saída

O gerador salva:

- HTML em `treinamentos/decks/<area>/<titulo>_v1.html`
- Registro em `treinamentos/catalog.json`

O catálogo publicado em Nginx lê `catalog.json`, então novos treinamentos aparecem na tela principal.

## Fluxo v2

1. O usuário conversa com o assistente para refinar o briefing.
2. A tela mantém campos estruturados: título, área, público, objetivo e tópicos.
3. A prévia lateral mostra o roteiro estimado.
4. Ao clicar em **Gerar treinamento**, a API renderiza o HTML no padrão 3F.

A conversa não substitui o schema. Ela serve para preparar os dados que entram no renderizador.
