# Visual Infographic Patterns

Use this reference when creating 3F training decks that need visual charts, infographic slides, KPI dashboards, visual summaries, roadmaps, objectives, products/services, pricing plans, process maps, or premium-looking corporate presentation pages.

The user-provided images and PDFs are taste references, not rigid templates. Do not copy them literally. Translate the visual intent into the 3F template and adapt the layout to the training content.

## Taste Direction

- Prefer clean corporate slides with strong hierarchy and generous whitespace.
- Use navy/blue as the stable base, with gold or controlled orange only for emphasis, active steps, highlights, or key values.
- Anchor visual slides with large numbers, icons, connectors, rings, cards, or step labels.
- Keep data readable from a distance. Avoid tiny legends, dense paragraphs, and decoration that competes with the KPI.
- Make each visual slide explain one relationship: comparison, sequence, flow, objective, distribution, funnel, or result.
- Use visual references as a menu of compositions. Choose the composition that best fits the content instead of forcing every visual into one style.

## Native Slide Pattern Mapping

- `chart-bar`: use for side-by-side comparisons, columns, sector performance, before/after bars, or stacked operational views.
- `chart-line`: use for trend, time series, SLA evolution, forecast, weekly/monthly tracking, or trajectory.
- `chart-pie`: use for share, distribution, mix, participation, portfolio split, or channel split.
- `chart-funnel`: use for conversion, operational funnel, pipeline, quality gates, backlog stages, or progressive loss.
- `decision-tree`: use for operational choices, escalation rules, exception handling, triage, and "if this, then that" training.
- `metric-donut`: use for "resultados em números", percentage rings, satisfaction, performance, retention, quality, adherence, and compact KPI highlights.
- `kpi-row`: use for quick KPI tiles, assessment summaries, dashboard strips, and operational scorecards.
- `performance-summary`: use when multiple KPI tiles and rings should appear as one executive summary.
- `infographic-timeline`: use for adoption cycles, phase plans, change stages, chronological roadmaps, training rollout, and maturity progression.
- `radial-steps`: use for 4-6 method steps, continuous improvement cycles, PDCA-like routines, and circular learning models.
- `process-map`: use for connected flows, data transformation, implementation roadmaps, service journeys, handoffs, and end-to-end processes.
- `icon-columns`: use for "quem somos", missão/visão/valores, pillars, products, services, and value proposition blocks.
- `pricing-table`: use for plans, packages, tiers, investment options, support levels, or comparison of service bundles.
- `objective-board`: use for objectives, targets, strategic priorities, expected behaviors, or checklist-style outcomes.

## Reusable Concepts From The Reference Images

- Premium infographic dark mode: use navy background, thin connector lines, circular percentage anchors, small supporting cards, and restrained light-blue labels.
- Bright infographic sheets: use teal/blue/green/orange as accents, but translate them to 3F blue/gold/orange so the deck still feels branded.
- Corporate white slides: use big icons, centered titles, simple columns, dotted corner accents only when subtle, and clear section spacing.
- Results-in-numbers slides: use 3 large donut rings or KPI tiles, each with one number and one label.
- Objectives slides: use a large target icon or visual anchor on one side and 3-5 check objectives on the other.
- Products/services slides: use 3 or 4 icon cards or columns, not paragraphs.
- Plans/pricing slides: use 3 cards with clear plan name, price/value, and short feature list.
- Roadmaps and transformation PDFs: use numbered markers, repeated cards, road-like paths, vertical step stacks, horizontal cycles, or benefits-vs-challenges two-sided layouts.

## PDF Reference Concepts

For the "Modern Digital Transformation Infographic Presentation" model, keep these reusable composition ideas:

- Digital funnel stages: large funnel/stepped visual plus short stage descriptions.
- Key transformation drivers: numbered driver cards around a central visual anchor.
- Digital adoption cycle: horizontal circular nodes with numbered phases.
- Traditional vs digital: two balanced columns with matched numbered rows.
- Implementation roadmap: path/road visual plus four staged descriptions.
- Data transformation flow: left-to-right flow with icon blocks and short captions.
- Continuous improvement step: vertical numbered cards with a left title block.
- Change management steps: stair-step progression with connected cards.
- Innovation journey roadmap: path or milestone map with 5 phases.
- Benefits vs challenges: two opposing sides, arrows or central contrast, and matched lists.

## Data And Content Rules

- If the user asks for a chart, collect or infer numeric values. Use structured `chart.labels`, `chart.unit`, and `chart.series[].values`.
- If exact numbers are unavailable, use clearly illustrative defaults only for test decks or fallback generation.
- Prefer 3-5 items per visual slide. Use 6 only for timelines/processes where the layout can still breathe.
- Keep item titles short: 1-4 words when possible.
- Keep item text to one short sentence. Move detailed explanation to instructor notes or a follow-up content slide.
- Never represent a requested visual chart only as a table.

## Selection Heuristics

- User says "gráfico de linha", "tendência", "evolução": choose `chart-line`.
- User says "colunas", "barras", "comparativo por setor": choose `chart-bar`.
- User says "pizza", "participação", "distribuição": choose `chart-pie`.
- User says "funil", "conversão", "etapas com perda": choose `chart-funnel`.
- User says "árvore de decisão", "regra de decisão", "quando fazer": choose `decision-tree`.
- User says "infográfico premium", "visual bonito", "resultado em números": choose `metric-donut`, `kpi-row`, or `performance-summary`.
- User says "roadmap", "linha do tempo", "jornada", "adoção": choose `infographic-timeline` or `process-map`.
- User says "etapas", "ciclo", "melhoria contínua": choose `radial-steps`.
- User says "objetivos", "metas", "alvos": choose `objective-board`.
- User says "produtos", "serviços", "quem somos", "missão/visão/valores": choose `icon-columns`.
- User says "planos", "preços", "pacotes": choose `pricing-table`.
