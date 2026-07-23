---
name: 3f-training-presentation-designer
description: Create, review, or refine 3F training presentations, HTML decks, and the conversational training generator using market-backed presentation patterns plus the official 3F visual template. Use for generator UX, briefing extraction, roteiro creation, slide density, dark/light parity, deck validation, or any task involving new training decks in treinamentos/.
---

# 3F Training Presentation Designer

## Overview

Use this skill to turn an initial training idea into a structured 3F training deck and to keep the generator aligned with presentation best practices, contact center needs, and the official 3F template.

Before major changes to the generator flow, briefing logic, slide structure, or visual template, read:

- `references/market-presentation-patterns.md`
- `references/3f-template-contract.md`
- `references/visual-infographic-patterns.md` when the user asks for visual charts, infographics, dashboards, roadmaps, objectives, products/services, plans, or presentation visuals inspired by references.
- `references/call-center-training-review.md`

## Workflow

1. Capture the training intent conversationally.
   - Start from theme, target audience, objective, duration, area, tone, level, practical activity, assessment, and expected slide count.
   - Do not ask for a long form before the user can start.
   - Ask short objective questions when required information is missing.

2. Normalize the briefing.
   - Treat title, theme, area, audience, objective, duration, level, tone, activity, assessment, and slide count as unique fields.
   - When the user corrects an answer, replace the previous value instead of duplicating it.
   - Keep topics as a deduplicated list, ordered by training flow.

3. Create the instructional structure.
   - Use a clear learning arc: context, why it matters, objective, core concepts, process, examples, practice, evaluation, summary, next steps.
   - Prefer one main idea per slide.
   - Make operational trainings practical: include examples, scenarios, decision points, and expected behavior.

4. Fit the 3F template.
   - Preserve official header, sidebar, footer, logo behavior, slide navigation, progress bar, theme toggle, and light/dark parity.
   - Use the standard `window.TRAINING_CONFIG.assets` block at the top of each generated HTML deck.
   - Use only official logos from `treinamentos/_assets/logos/`.

5. Validate before finishing.
   - Generate or inspect at least one sample deck when changing generation behavior.
   - Check light and dark mode for contrast, especially cards, gradient text, footer lines, and sidebar icons.
   - Confirm collapsed sidebar icons remain centered and that the footer matches the official template.
   - Remove temporary generated decks after validation unless the user requested keeping them.

## Presentation Rules

- Design for training application, not marketing.
- Keep titles concise and useful to the instructor.
- Use visual hierarchy to make the slide scannable from a distance.
- Avoid dense paragraphs on slides; move detail into notes or smaller supporting text.
- Use gold only for important emphasis or primary actions.
- Use blue for IA/system information and light-mode footer lines.
- Make the generator screen feel like a creation tool, with the chat as the center and briefing/roteiro/action panels as support.

## Generator Behavior

- Keep the first IA prompt simple: "Qual treinamento voce quer criar? Me diga o tema, o publico e o principal objetivo."
- Update Briefing and Roteiro automatically as the conversation progresses.
- Show missing information in a clear status area.
- Disable generation until required fields are present.
- Allow post-generation edits without restarting the briefing.
- Keep LLM configuration behind the API key validation flow and read provider keys from `.env`.

## Output Standard

When proposing or implementing a generator/deck change, include:

- What changed in the user experience.
- What changed in the deck/template contract.
- How the change was validated.
- Any remaining gap that could make a generated training inconsistent.
