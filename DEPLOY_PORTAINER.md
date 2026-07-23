# Deploy Local dos Treinamentos 3F no Portainer

Este projeto foi organizado para servir todos os treinamentos localmente na intranet usando Nginx em Docker.

## Estrutura publicada

- `treinamentos/index.html`: página inicial do catálogo.
- `treinamentos/decks/`: HTMLs dos treinamentos.
- `treinamentos/_assets/`: imagens locais usadas nos decks.
- `nginx.conf`: configuração do servidor estático.
- `docker-compose.portainer.yml`: stack pronta para colar no Portainer.
- `generator/`: frontend e API local para gerar novos treinamentos no padrão 3F.

## Deploy pelo Portainer

1. Abra o Portainer.
2. Entre no ambiente `local`.
3. Vá em **Stacks**.
4. Clique em **Add stack**.
5. Nome sugerido: `treinamentos-3f`.
6. Cole o conteúdo de `docker-compose.portainer.yml`.
7. Clique em **Deploy the stack**.

Endereço padrão:

```text
http://192.168.10.35:8088
```

Gerador de treinamentos:

```text
http://192.168.10.35:8091
```

Ao abrir o gerador, informe a chave configurada em `GENERATOR_API_KEY`.

Para Docker Desktop local, use o arquivo `.env` na raiz do projeto. Ele não vai para o Git.

Para trocar a chave no Portainer, defina no stack ou nas variáveis de ambiente:

```text
GENERATOR_API_KEY=<chave-forte-do-gerador>
```

Por padrão local de desenvolvimento, o compose usa:

```text
3f-treinamentos-local
```

Se a porta `8088` já estiver em uso, troque o lado esquerdo em `ports`, por exemplo:

```yaml
ports:
  - "8090:80"
```

## Como publicar novos treinamentos

1. Crie ou copie o HTML para `treinamentos/decks/<area>/`.
2. Coloque imagens locais em `treinamentos/_assets/` ou subpastas.
3. Registre o link em `treinamentos/catalog.json`.
4. Se o container já estiver rodando com volume, basta salvar os arquivos. Não precisa rebuild.

## Gerador com LLM

O serviço `treinamentos-generator` funciona mesmo sem chave de LLM: nesse caso ele gera um rascunho local a partir dos tópicos informados.

**A chave da LLM se configura pela tela do gerador, não por variável do stack.**
A tela tem 5 slots de LLM e grava no `.env` montado no container. Como a aplicação
reescreve esse arquivo, ele é a fonte da verdade dessas configurações — declarar
`LLM_API_KEY`, `LLM_MODEL`, `LLM_API_URL` ou `LLM_ACTIVE_SLOT` no stack criaria uma
segunda fonte que o próximo redeploy reimporia por cima do que foi salvo na tela.
Por isso essas variáveis não aparecem no `docker-compose.portainer.yml`.

Para o primeiro setup, dá para semear a chave editando o `.env` à mão antes de subir
o stack — depois disso, use a tela.

> **O `.env` é arquivo de estado, não só de configuração.** Inclua no backup e nunca
> o recrie do zero num redeploy: as chaves de LLM cadastradas pela tela se perdem.
> Mantenha o volume do `.env` declarado no stack.

Variáveis que continuam sendo do stack (a tela não mexe nelas):

```text
GENERATOR_REQUIRE_AUTH=true
GENERATOR_API_KEY=<chave-forte-do-gerador>
CATALOG_BASE_URL=http://192.168.10.35:8088
LLM_ALLOWED_HOSTS=
LLM_TIMEOUT_MS=60000
TRUST_PROXY=false
```

Ligue `TRUST_PROXY=true` só se o gerador estiver atrás de um proxy reverso. Sem isso,
atrás de proxy todas as requisições chegam com o mesmo IP e 10 tentativas erradas de
um atacante bloqueiam o acesso de todo mundo por um minuto.

O gerador salva o HTML em `treinamentos/decks/<area>/` e atualiza `treinamentos/catalog.json`.

## Regra local

Os treinamentos devem concentrar links de imagem em `window.TRAINING_CONFIG.assets` no topo do HTML. No corpo dos slides, use `data-asset`.

Observação: os decks ainda carregam Google Fonts e Font Awesome via CDN. Para operação 100% offline, essas dependências precisam ser baixadas e referenciadas por arquivos locais.
