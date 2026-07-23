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
