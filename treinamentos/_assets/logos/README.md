# Logos 3F

Pasta oficial para armazenar as versões locais das logos usadas nos treinamentos.

## Padrão atual

| Arquivo | Uso recomendado |
|---------|-----------------|
| `Logo_horizontal_branca.png` | Sidebar e rodapé dos decks em fundo escuro |
| `Logo_horizontal_Azul.png` | Materiais em fundo claro quando a marca azul tiver melhor contraste |
| `Logo_horizontal_preta.png` | Materiais em fundo claro quando a marca preta tiver melhor contraste |
| `Logo_vertical_branca.png` | Composições verticais em fundo escuro |
| `Logo_vertical_azul.png` | Composições verticais em fundo claro |
| `Logo_vertical_preta.png` | Composições verticais em fundo claro |

## Convenção de nomes

Use nomes descritivos e estáveis:

```text
Logo_horizontal_branca.png
Logo_horizontal_Azul.png
Logo_horizontal_preta.png
Logo_vertical_branca.png
Logo_vertical_azul.png
Logo_vertical_preta.png
```

## Regra de uso

Os HTMLs devem apontar para as logos pelo bloco `window.TRAINING_CONFIG.assets`.

Exemplo em decks dentro de `decks/<area>/`:

```js
logo3f:'../../_assets/logos/Logo_horizontal_branca.png'
```

URL original da logo atualmente baixada:

```text
https://storage.directlinecontactcenter.com.br/docspost/Logo_horizontal_branca.png
```
