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

Para usar uma LLM, configure uma destas variáveis no Portainer antes do deploy:

```text
LLM_API_KEY
```

ou:

```text
OPENAI_API_KEY
```

Variáveis opcionais:

```text
GENERATOR_REQUIRE_AUTH=true
GENERATOR_API_KEY=<chave-forte-do-gerador>
CATALOG_BASE_URL=http://192.168.10.35:8088
LLM_MODEL=gpt-4.1-mini
LLM_API_URL=https://api.openai.com/v1/chat/completions
```

O gerador também possui uma tela de configuração com 5 slots de LLM. No Docker Desktop local, essa tela salva no `.env` montado no container. No Portainer, mantenha o volume do `.env` configurado no stack para permitir essa persistência.

O gerador salva o HTML em `treinamentos/decks/<area>/` e atualiza `treinamentos/catalog.json`.

## Regra local

Os treinamentos devem concentrar links de imagem em `window.TRAINING_CONFIG.assets` no topo do HTML. No corpo dos slides, use `data-asset`.

Observação: os decks ainda carregam Google Fonts e Font Awesome via CDN. Para operação 100% offline, essas dependências precisam ser baixadas e referenciadas por arquivos locais.
