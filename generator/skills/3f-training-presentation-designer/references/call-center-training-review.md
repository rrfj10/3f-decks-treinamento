# Jarvis Review: Call Center Training Generator

## Executive Diagnosis

Problem:

The generator is evolving into a training creation tool, but it still needs stronger operational intelligence so it does not create generic presentations for call center topics.

Operational impact:

If the IA only generates slides from a theme, the training may look good but fail to improve SLA, qualidade, produtividade, aderencia, conversao, retencao, governanca, or rotina de lideranca.

Likely cause:

The current briefing focuses on presentation fields, but it does not yet force the training to connect each topic with operational behavior, KPI, audience role, and evidence of learning.

Recommendation:

Evolve the generator from "chat that creates slides" to "assistant that diagnoses the training need, maps the operational objective, and produces a deck ready for application".

Concrete next step:

Add a call center intelligence layer to the briefing and roteiro engine.

## Required Operational Fields

The generator should identify these fields when the training topic involves call center:

- Operation type: SAC, televendas, retencao, cobranca, suporte, back-office, NOC, MIS, planejamento, qualidade, RH, lideranca.
- Audience role: operador, supervisor, coordenador, gerente, administrativo, analista, instrutor.
- Operational pain: fila, TME, TMA, NS, SLA, abandono, aderencia, absenteismo, qualidade, conversao, rechamada, erro de processo, retrabalho, governanca.
- KPI target: metric affected by the training.
- Expected behavior change: what people should do differently after training.
- Practice format: roleplay, checklist, scenario, quiz, case review, guided exercise.
- Evidence of learning: final quiz, checklist completion, observed simulation, supervisor validation.

## Generator UX Changes Recommended

- Add a compact "Impacto Operacional" section below Briefing or inside Briefing.
- Add chips for common contact center areas:
  - SAC
  - Televendas
  - Retencao
  - Cobranca
  - Planejamento
  - Qualidade
  - NOC
  - MIS
  - RH
  - Lideranca
- When a KPI term appears, auto-classify it using call center terminology.
- When the user gives a generic goal, ask for the operational result:
  - "Esse treinamento deve melhorar qual indicador ou comportamento?"
  - "O publico vai aplicar isso em atendimento, gestao, planejamento ou qualidade?"
- Keep the user out of long forms; surface the structure automatically in support panels.

## Roteiro Rules for Call Center

For operational training, the default roteiro should include:

1. Contexto da operacao
2. Problema ou risco atual
3. Objetivo do treinamento
4. Indicadores impactados
5. Conduta ou processo esperado
6. Exemplo pratico da operacao
7. Erros comuns
8. Boas praticas
9. Atividade ou simulacao
10. Checagem de aprendizado
11. Plano de aplicacao
12. Fechamento

## Governance Risks

- Training without target audience creates slide content too generic.
- Training without KPI or behavior target becomes hard to measure.
- Training without activity may not change execution in atendimento.
- Training without assessment creates weak evidence of understanding.
- Training without template validation risks visual drift between generated decks.

## Priority Matrix

High impact, low effort:

- Deduplicate briefing fields.
- Add operational impact fields.
- Add smarter chips based on call center area.
- Require audience and duration before generation.

High impact, medium effort:

- Map common KPI terms to roteiro suggestions.
- Add post-generation revision loop.
- Add deck validation step after generation.

High impact, high effort:

- Connect real LLM provider with reliable prompt orchestration.
- Add persistent drafts and generation history.
- Add reviewer mode for RH/gestor before publishing.
