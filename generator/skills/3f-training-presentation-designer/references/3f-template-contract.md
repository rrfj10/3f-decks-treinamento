# 3F Template Contract

Use this contract when editing `treinamentos/`, `generator/public/`, or `generator/server.mjs`.

## Core Files

- Catalog: `treinamentos/index.html`
- Official base template: `treinamentos/_template/base-template.html`
- Generator UI: `generator/public/index.html`
- Generator behavior: `generator/public/app.js`
- Generator backend: `generator/server.mjs`
- Official logos: `treinamentos/_assets/logos/`

## Visual Contract

- Preserve the official 3F visual system: navy/black background in dark mode, light operational background in light mode, gold accents, blue system accents.
- The footer logo and horizontal lines must match the official deck pattern.
- In light mode, footer lines should use blue so they remain visible.
- In dark mode, footer lines should use gold.
- The sidebar must support expanded and collapsed states.
- In collapsed state, logo and icons must be optically centered.
- The collapse button belongs outside the sidebar near "PROGRESSO GERAL".
- Theme toggle must be icon-only and positioned at the far right of the top controls across screens.
- Do not leave light-mode cards as dark blocks unless that is an intentional high-contrast object with readable text.
- Gradient title text must remain readable in both themes; in light mode, pull the gradient toward blue/navy instead of white/gold.

## Deck Configuration Contract

Every training HTML deck should keep asset links centralized near the top:

```html
<script>
  window.TRAINING_CONFIG = {
    assets: {
      logoHorizontal: "../../_assets/logos/...",
      logoVertical: "../../_assets/logos/..."
    }
  };
</script>
```

Body markup should reference assets through `data-asset` or the existing resolver pattern instead of scattering image paths through the document.

## Generator Contract

- The generator must not create duplicate briefing fields.
- Unique fields should be overwritten when corrected.
- Topics should be deduplicated by normalized text.
- Missing required fields should appear in the status block and action tooltip.
- When the user asks for visual charts, generated decks should use native visual slide types instead of replacing the request with tables or text-only explanations:
  - `chart-bar` for bar/column comparisons.
  - `chart-line` for trends and time series.
  - `chart-pie` for share/distribution.
  - `chart-funnel` for funnel stages.
  - `decision-tree` for operational decision paths.
- Chart slides should provide structured numeric data through `chart.labels`, `chart.unit`, and `chart.series[].values`. Tables may accompany charts, but should not be the only representation when the request is explicitly visual.
- When the user asks for premium infographics, dashboards, visual summaries, roadmaps, objectives, plans/pricing, who-we-are blocks, products/services, or process diagrams, the generator should use native visual pattern slide types instead of plain cards:
  - `metric-donut` for percentage/KPI rings and "resultados em números".
  - `kpi-row` or `performance-summary` for KPI tiles, assessment summaries, and operational scoreboards.
  - `infographic-timeline` for chronology, adoption cycles, change stages, and phased rollouts.
  - `radial-steps` for circular step models and methods with 4-6 steps.
  - `process-map` for connected flows, data transformation paths, roadmaps, and journeys.
  - `icon-columns` for "quem somos", missão/visão/valores, products, services, and pillar slides.
  - `pricing-table` for plan, package, investment, or tier comparisons.
  - `objective-board` for objectives, goals, targets, and checklist-style strategic priorities.
- Treat user-provided visual references as flexible taste guidance, not absolute rules. Prefer the shared direction: clean corporate layouts, strong hierarchy, large numeric anchors, icon-led blocks, blue/navy base, controlled gold/orange emphasis, clear connectors, generous whitespace, and readable data. Adapt the pattern to the training content instead of copying a reference literally.
- For visual references similar to the "Modern Digital Transformation Infographic Presentation" PDF, preserve the reusable concepts: funnel stages, numbered drivers, adoption cycles, traditional-vs-digital comparisons, implementation roadmaps, data transformation flows, continuous improvement steps, change management stair-steps, innovation journey maps, and benefits-vs-challenges comparisons.
- Generated decks must inherit:
  - official sidebar behavior;
  - official footer;
  - official light/dark behavior;
  - top asset config block;
  - consistent navigation controls;
  - readable contrast in both modes.

## Validation Contract

Before considering deck or generator work done:

- Open or serve the relevant page locally when practical.
- Exercise light and dark mode.
- Check a generated sample deck if generation code changed.
- Confirm no temporary generated deck remains unless requested.
- Confirm `.env` is ignored and `.env.example` remains safe to commit.
- Confirm `.agents`, `_dl`, `_dl-output`, `.claude`, `.opencode`, and `.github/skills` are not added to Git.
