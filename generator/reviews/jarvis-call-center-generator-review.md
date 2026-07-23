# Revisao Jarvis: Gerador de Treinamentos 3F

Data: 2026-07-23

## Diagnostico Executivo

Problema:

O gerador ja esta bem encaminhado como tela conversacional, mas precisa evoluir para nao criar treinamentos genericos. Para uma operacao de contact center, o valor real esta em conectar cada treinamento a comportamento operacional, indicador, publico e evidencia de aprendizagem.

Impacto operacional:

Sem essa camada, a apresentacao pode ficar bonita e dentro do template, mas nao necessariamente melhora atendimento, qualidade, produtividade, SLA, conversao, retencao, aderencia, governanca ou rotina de lideranca.

Causa provavel:

O briefing atual captura campos de apresentacao. Ele ainda precisa capturar campos de operacao: tipo de area, dor operacional, KPI impactado, comportamento esperado, pratica e avaliacao.

Recomendacao:

Manter o chat como centro da experiencia, mas adicionar inteligencia operacional no motor de briefing/roteiro. O usuario continua conversando normalmente; a IA organiza por tras.

## Ajustes Recomendados

1. Adicionar "Impacto Operacional" ao briefing.
   - Tipo de operacao: SAC, televendas, retencao, cobranca, suporte, NOC, MIS, planejamento, qualidade, RH ou lideranca.
   - KPI impactado: NS, SLA, TME, TMA, abandono, aderencia, absenteismo, qualidade, conversao, retencao, retrabalho ou governanca.
   - Comportamento esperado: o que o publico deve fazer diferente apos o treinamento.

2. Melhorar os chips inteligentes.
   - Incluir atalhos por area operacional.
   - Sugerir perguntas de KPI quando o tema for call center.
   - Sugerir pratica ou avaliacao quando o tema envolver comportamento, processo ou atendimento.

3. Fortalecer o roteiro padrao.
   - Contexto da operacao.
   - Problema ou risco atual.
   - Objetivo do treinamento.
   - Indicadores impactados.
   - Conduta ou processo esperado.
   - Exemplo pratico.
   - Erros comuns.
   - Boas praticas.
   - Atividade ou simulacao.
   - Checagem de aprendizado.
   - Plano de aplicacao.
   - Fechamento.

4. Criar validacao antes de gerar.
   - Nao gerar se faltar publico, objetivo, duracao e criterio minimo de aplicacao.
   - Para treinamentos operacionais, recomendar KPI ou comportamento alvo.

5. Criar revisao pos-geracao.
   - A IA deve permitir ajustes sem reiniciar.
   - Exemplos: reduzir slides, tornar mais pratico, adicionar dinamica, incluir avaliacao, ajustar tom para operador ou gestor.

## Prioridade

Fazer agora:

- Mover a skill versionada para `generator/skills/`.
- Usar a skill como contrato para proximas alteracoes do gerador.
- Adicionar campos de impacto operacional no modelo de briefing.

Planejar:

- Mapear KPIs comuns para sugestoes automaticas de roteiro.
- Criar reviewer interno para verificar se o treinamento nasceu aderente ao template.

## Proximo Passo Tecnico

Implementar no gerador:

- novos campos de briefing operacional;
- deduplicacao tambem para esses campos;
- chips por contexto de call center;
- status de prontidao considerando publico, objetivo, duracao e impacto operacional.
