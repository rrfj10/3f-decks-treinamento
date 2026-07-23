# Treinamentos 3F — Universidade Corporativa

Repositório dos treinamentos corporativos da 3F Contact Center. Cada treinamento é um **deck HTML autocontido** seguindo o [padrão oficial](_template/PADRAO.md).

## Estrutura

```
treinamentos/
├── _template/        # Modelo base + regras do padrão (fonte de verdade)
│   ├── base-template.html
│   └── PADRAO.md
├── _assets/          # Recursos compartilhados (logo, imagens)
│   └── logo-3f.txt
├── decks/            # Treinamentos, organizados por área/setor
│   ├── Planejamento/
│   │   └── control_desk_universidade_corporativa_v_3.html
│   └── rh/
│       └── feedback_360_v1.html
└── README.md
```

## Como criar um treinamento novo
1. Copiar `_template/base-template.html` para `decks/<area>/<nome>_v1.html`
2. Ajustar título, módulos e conteúdo mantendo o [padrão](_template/PADRAO.md)
3. Registrar na tabela abaixo

## Índice de treinamentos

| Área | Treinamento | Versão | Arquivo | Status |
|------|-------------|--------|---------|--------|
| Planejamento | Control Desk — Gestão em Tempo Real | v3 | [abrir](decks/Planejamento/control_desk_universidade_corporativa_v_3.html) | ✅ Pronto |
| RH | Sistema de Feedback 360° | v1 | [abrir](decks/rh/feedback_360_v1.html) | ✅ Pronto (20 slides, prints reais anotados) |

## Publicação local na intranet

Este projeto pode ser servido localmente com Docker/Nginx. A página inicial é [`index.html`](index.html), que concentra os links dos treinamentos publicados.

Na raiz do projeto, suba o serviço com:

```bash
docker compose up -d
```

Endereço padrão:

```text
http://<ip-do-servidor>:8088
```

No Portainer, use **Stacks > Add stack** e aponte para o `docker-compose.yml` da raiz do projeto. O compose monta a pasta `treinamentos/` como volume somente leitura dentro do Nginx, então alterações nos HTMLs ficam disponíveis após salvar o arquivo.

Para colar diretamente no Portainer, use o arquivo [`../docker-compose.portainer.yml`](../docker-compose.portainer.yml), que já está com caminhos absolutos para este host.

## Gerador interno de treinamentos

O projeto inclui um gerador conversacional com frontend e API local em `../generator/`.

Endereços padrão:

```text
Catálogo: http://<ip-do-servidor>:8088
Gerador:  http://<ip-do-servidor>:8091
```

O gerador permite conversar com uma LLM para refinar o briefing. A tela mantém campos estruturados, gera um JSON de slides, renderiza o HTML no padrão 3F, salva o arquivo em `decks/<area>/` e atualiza [`catalog.json`](catalog.json).

Sem chave de LLM, ele usa modo fallback local. Com `LLM_API_KEY` ou `OPENAI_API_KEY`, chama a API configurada em `LLM_API_URL`.

## Regra de assets locais

- Imagens dos decks devem ficar em `_assets/` ou subpastas.
- Links/caminhos de imagem devem ficar no bloco `window.TRAINING_CONFIG.assets` no topo de cada HTML.
- No corpo do HTML, use `data-asset` em vez de `src`.
- A logo padrão é `_assets/logos/Logo_horizontal_branca.png`.

## Áreas / setores
- **Planejamento** — Control Desk, monitoria, tempo real, WFM
- **rh** — Feedback 360°, desenvolvimento, gestão de pessoas
- _(adicionar conforme necessário: qualidade, comercial, treinamento-inicial...)_
