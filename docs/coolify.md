# Deploy no Coolify

**A produção roda aqui**, no Coolify, com `compose.coolify.yml`. Ele complementa
a instalação standalone de `compose.prod.yml`: os dois usam Docker Compose e os
estágios `runtime` e `ops` do mesmo Dockerfile. A instalação standalone
(`compose.prod.yml` + `scripts/deploy.sh`, no `docs/runbook.md`) não é a
produção atual. Não existe mais deploy automático via AWS/SSM.

## Deploy no dia a dia

- **Manual**: depois do merge na `main`, botão **Redeploy** do recurso no painel
  do Coolify. Nada sobe sozinho com o merge.
- **O build roda no servidor**: o Coolify builda o Dockerfile (estágio `build`:
  `prisma generate && pnpm build`) a cada Redeploy. As imagens que o workflow
  `imagens` publica no GHCR não são usadas aqui. O mesmo `next build` roda em
  todo PR no workflow `build` (`.github/workflows/build.yml`): PR com esse check
  vermelho quebraria o Redeploy.
- **Migrations**: rodam no serviço one-shot `migrate` antes do app (ver
  "Migrations automáticas" abaixo). Falhou: o app não sobe com a versão nova.
- **Sem backup automático**: nem o Coolify (como está configurado) nem o
  `deploy.sh` fazem dump antes do deploy. Antes de um Redeploy com migration
  nova, faça o backup do recurso PostgreSQL no painel ou um `pg_dump` à mão
  (exemplo no runbook, "Ciclo único (GAB-81)", passo 1).
- **Rollback**: revert na `main` e Redeploy (ou apontar o recurso para o commit
  anterior e Redeploy). O schema do banco não volta
  (expand/contract, runbook §2); para desfazer dados, restaure o backup.

## Configurar a aplicação

1. No recurso de aplicação com este repositório, selecione **Compose** como
   estratégia de build, diretório base `/` e arquivo `/compose.coolify.yml`.
2. Mantenha as variáveis existentes em **Environment Variables**. O arquivo não
   exige copiar nem substituir o `.env` atual. `DATABASE_URL` e `APP_URL` são
   obrigatórias e são repassadas ao app sem reconstruir seus valores.
3. O PostgreSQL do CRM continua sendo um recurso separado. Ele precisa estar
   iniciado e acessível na rede Docker externa `coolify`. Se a rede real tiver
   outro nome, configure `COOLIFY_DATABASE_NETWORK`. Use a URL interna desse
   recurso, nunca `localhost` nem a URL de um banco vazio criado por outro Compose.
4. Confira `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `CRON_SECRET`,
   `EVOLUTION_DB_PASSWORD` e `EVOLUTION_REDIS_PASSWORD`. Preserve os valores já
   definidos; preencha apenas os ausentes com segredos fortes. Para senhas
   inseridas em URLs, prefira hexadecimal (`openssl rand -hex 32`).
5. A URL interna padrão da Evolution é `http://evolution:8080`. Se houver uma
   `EVOLUTION_API_URL` antiga apontando para `localhost` ou para um placeholder,
   corrija somente essa variável. Os demais valores existentes são preservados.
6. Em **Domains**, associe o serviço `app` a
   `https://crm.seudominio.com.br:3000`. A porta é interna; o acesso público
   continua por HTTPS na porta 443. Use a mesma origem em `APP_URL`, sem `:3000`.
7. Entrar com Google (opcional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e
   `GOOGLE_DOMINIOS_PERMITIDOS=sou.inteli.edu.br` (padrão do compose). URI de
   redirecionamento no Google Cloud: `<APP_URL>/api/auth/google/callback`. Passo a
   passo: runbook §14.
8. Carregue o Compose e faça o deploy com build das imagens `app` e `migrate`.
   Ambos devem vir do mesmo commit. Os serviços Evolution, PostgreSQL da
   Evolution e Redis são iniciados pelo Compose.

Não há Caddy, publicação de portas na VPS nem outro banco para o CRM neste
arquivo. O Coolify fornece o proxy HTTPS. Evolution, seu banco e Redis se
comunicam em redes internas; apenas a Evolution também tem rede de saída para
conectar ao WhatsApp. Os três volumes da Evolution persistem entre redeploys.

O `app` tem um volume próprio, `app_anexos`, montado em `/data/anexos`
(`ANEXOS_DIR`): os arquivos anexados aos Projetos (GAB-84). Ele persiste entre
redeploys como os da Evolution; o Coolify prefixa o nome com o UUID do recurso
(`docker volume ls | grep app_anexos`). A imagem cria `/data/anexos` com dono
`node` (uid 1000), então o volume novo já nasce gravável pelo app.

Se uma tentativa com `compose.prod.yml` já criou um serviço `db`, não confunda
esse banco com o recurso PostgreSQL original. Confira a `DATABASE_URL` antes do
deploy. Volumes antigos não são apagados por esta alteração; não use
`docker compose down -v` nem remova o recurso PostgreSQL para corrigir conectividade.

## Migrations automáticas

O serviço `migrate` usa o estágio `ops` já existente e executa
`prisma migrate deploy` com a mesma `DATABASE_URL` do app. O app depende de
`service_completed_successfully`: só inicia quando as migrations terminam com
código zero. Falha na conexão ou na migration bloqueia a inicialização.

No Coolify, `exclude_from_hc: true` exclui esse container de execução única da
saúde agregada. Ele aparecer encerrado após sucesso. Seed, criação de usuários e
o smoke de LLM não rodam automaticamente. O serviço `llm-smoke` permanece
opcional no perfil `ops`.

Faça backup antes de migrations e mantenha expand/contract: uma migration pode
alterar o banco mesmo se a nova aplicação falhar depois. O deploy Compose não
fornece, por si só, rollback transacional do banco.

## Conferir o primeiro deploy

- `migrate`: terminou com código 0, com migrations aplicadas ou nenhuma pendente.
- `app`, `evolution`, `evolution-db` e `evolution-redis`: em execução e saudáveis.
- `/api/health` e `/login` do domínio do CRM respondem por HTTPS.
- O login e uma leitura do Kanban funcionam usando o banco esperado.
- A área administrativa do CRM consegue consultar a Evolution pela rede interna.

Pareamento por QR, escolha do grupo e configuração do webhook da Evolution
continuam sendo etapas operacionais do README. Deixe `NOTIFICATIONS_ENABLED=false`
durante a configuração inicial; o Compose respeita o valor existente e não envia
mensagens de teste por conta própria.

Os scripts de operação existentes (`deploy.sh`, `backup.sh`, `restore.sh` e
`evolution.sh`) continuam voltados à instalação standalone: usam
`compose.prod.yml`, seu serviço `db` e/ou Caddy. Não os execute esperando que
administrem este recurso Coolify. Use o backup do recurso PostgreSQL no painel,
as telas de administração do CRM e comandos/API direcionados explicitamente aos
containers deste stack.

**Os anexos dos Projetos não entram no backup do PostgreSQL.** Não há backup
automático do volume `app_anexos`: faça à mão, logo depois do dump do banco,
com os comandos de backup e restore em `docs/runbook.md`, seção "Anexos dos
Projetos (volume `app_anexos`, GAB-84)". Em resumo:

```bash
APP=<nome-do-container-app>    # docker ps --format '{{.Names}}' | grep '^app'
docker exec "$APP" tar czf - --exclude='*.tmp' -C /data/anexos . > anexos-$(date -u +%Y%m%dT%H%M%SZ).tar.gz   # backup
docker exec -i "$APP" tar xzf - -C /data/anexos < anexos-<UTC>.tar.gz                                    # restore
``` O webhook interno da Evolution deve apontar para
`http://app:3000/api/webhooks/evolution`, com o header `x-webhook-secret` igual a
`EVOLUTION_WEBHOOK_SECRET`, conforme o contrato descrito no README.

## Validar o arquivo sem subir serviços

```bash
python3 scripts/teste-compose-coolify.py
```

O teste usa `docker compose config` com valores fictícios, sem daemon, rede de
produção ou credenciais reais. Ele remove somente a extensão de saúde do Coolify
antes da validação do schema padrão do Compose.
