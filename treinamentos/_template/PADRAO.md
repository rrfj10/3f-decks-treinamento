# Padrão de Treinamentos 3F

Todo treinamento é um **único arquivo HTML**, `lang="pt-BR"`, autocontido, no formato de **deck de slides navegável**. Sempre partir de [`base-template.html`](base-template.html).

## Dependências (CDN)
- Google Fonts: **Montserrat** (300–800) + **Orbitron** (500–900)
- **Font Awesome 6.5.1**

## Paleta (`:root`)
| Var | Cor | Uso |
|-----|-----|-----|
| `--primary` | `#003467` | azul base |
| `--secondary` | `#003D38` | verde escuro |
| `--accent` | `#F0C55A` | dourado (destaques) |
| `--light` | `#5E88C1` | azul claro |
| `--dark` | `#04101d` | escuro |
| `--card` | `rgba(8,20,40,0.72)` | fundo de cards |
| `--border` | `rgba(94,136,193,0.22)` | bordas |

Fundo body `#020B16` + gradientes radiais/lineares + grid sutil. Títulos em **Orbitron** uppercase. `.gradient-title` = texto com gradiente branco→dourado.

## Logo 3F (sidebar + footer)
Usar a logo real salva localmente em `_assets/logos/Logo_horizontal_branca.png`.

Cada deck deve referenciar a logo pelo bloco `window.TRAINING_CONFIG.assets`, ajustando o caminho relativo conforme a pasta do arquivo:

- Template em `_template/`: `../_assets/logos/Logo_horizontal_branca.png`
- Decks em `decks/<area>/`: `../../_assets/logos/Logo_horizontal_branca.png`

## Configuração de imagens
Todo link/caminho de imagem deve ficar concentrado no bloco `window.TRAINING_CONFIG` no topo do HTML, antes do `<style>`.

Formato padrão:

```html
<script>
window.TRAINING_CONFIG={
assets:{
logo3f:'../../_assets/logos/Logo_horizontal_branca.png',
printExemplo:'../../_assets/screenshots/exemplo.png'
}
};
</script>
```

No corpo do treinamento, use apenas a chave configurada:

```html
<img data-asset="logo3f" alt="3F Contact Center">
<img data-asset="printExemplo" alt="Descrição objetiva da imagem">
```

Não espalhe `src` com URLs ou caminhos de prints no meio dos slides. Para trocar uma imagem, edite somente o valor correspondente em `window.TRAINING_CONFIG.assets`.

## Estrutura da página
- **Sidebar fixa 260px**: logo, `.training-title`, `.training-subtitle`, `.menu` (módulos), `.progress-card`
- **Main**: `.topbar` (barra de progresso + botões + contador), `.slides`, `.slide-footer` (logo), `.navigation` (anterior/próximo)

## Slides
- Cada slide = `<section class="slide">`, o primeiro com `.active`
- Sequência: **Capa** (`.capa-layout`) → **módulos numerados** (cada um abre com `.badge` "Módulo N" + `<h2>` com span `.gradient-title`) → **Encerramento**
- Itens do menu chamam `goSlide(i)` — manter em sincronia com a contagem de slides

## Componentes reutilizáveis
`.card` + `.grid-2/3/4` · `.kpi-grid`/`.kpi-columns`/`.kpi-section-title` · `.two-col`/`.col-block`/`.col-list` · `.flow-steps` · `.tool-card` · `.comp-card` · `.timeline`/`.timeline-checklist` · `.levels-row`/`.level-card`/`.level-arrow` · `.message-box`/`.shield`

## JS
`updateSlides` / `nextSlide` / `prevSlide` / `goSlide` · barra de progresso % · sidebar mobile `toggleSidebar`/`closeSidebar`
- **Menu navega por posição** (`menuItems.forEach(...goSlide(i))`) — não use `onclick="goSlide(N)"` fixo; a ordem dos itens = ordem dos slides.

## Barra de ações (100% funcional)
- **Atalhos** (`toggleShortcuts`) — modal com as teclas.
- **Tela Cheia** (`toggleFullscreen`) — Fullscreen API; ícone alterna expand/compress.
- **Modo Instrutor** (`toggleInstructor`) — painel inferior com notas editáveis, timer e próximo slide.
  - Notas: o campo é uma `<textarea>` editável na tela. O instrutor digita e **salva sozinho** no navegador (`localStorage`, chave `dl-notes:<title>:<índice>`). `data-notes="..."` na `<section>` serve como **valor padrão** (semente) até o instrutor editar.
- **Marcador** (`togglePen`) — pincel sobre `<canvas>` full-screen (`#drawCanvas`). Desenho à mão livre para circular/sinalizar ao vivo. **Efêmero:** não salva e limpa ao trocar de slide.
- **Teclado:** →/Espaço próximo · ← anterior · Home/End primeiro/último · **F** tela cheia · **P** instrutor · **D** marcador · **C** limpar marcações · **?** atalhos · **Esc** fecha/sai.

## Responsivo
Breakpoints: **1400 / 1200 / 980 (sidebar mobile) / 640px**

## Idioma
Comunicação e documentos em **pt-br**.

## Referência
Deck modelo: [`../decks/operacoes/control_desk_universidade_corporativa_v_3.html`](../decks/operacoes/control_desk_universidade_corporativa_v_3.html)
