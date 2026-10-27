# Runbook de produção — ij-crm

Operação da VPS (GAB-30). Stack: `compose.prod.yml` com `caddy` (únicas portas
públicas: 80/443, só o app), `app`, `db` (Postgres 16), `evolution` +
`evolution-db` + `evolution-redis` (sem rota pública: porta só em `127.0.0.1`
da VPS) e o one-shot `migrate` (perfil `ops`). Repo em `/opt/ij-crm`.

Atalho usado em todo este documento (rode na raiz do repo):

```bash
alias dc='docker compose -f compose.prod.yml'
```

| Arquivo | Para quê |
|---|---|
| `scripts/deploy.sh` | deploy (`checa → pull → build → backup → migrate → up → health`) e `rollback` |
| `scripts/backup.sh` | `pg_dump` do banco do CRM, retenção de 14 dias, cópia off-site (`BACKUP_REMOTE`) |
| `scripts/restore.sh` | restaura um dump do CRM (destrutivo, pede confirmação) |
| `scripts/evolution.sh` | instância do WhatsApp: criar, QR, estado, webhook, grupos, logout |
| `scripts/cron-reprocessar.sh` | `POST /api/cron/reprocessar` com o segredo no header |
| `deploy/crontab.example` | crontab do host (backup diário + reprocessar a cada 10 min) |
| `.env.prod.example` | todas as variáveis de produção |

Redes (alcance mínimo, verificado no GAB-30): Caddy só alcança o app; o app
alcança `db` e `evolution`; a Evolution alcança `evolution-db`,
`evolution-redis` e o app (webhook); bancos e Redis não têm saída para a internet.

---

## Checklist de go-live (bloqueios)

- [ ] DNS `A`/`AAAA` de `APP_DOMAIN` apontando para a VPS; portas 80/443 abertas.
- [ ] `.env` preenchido (todos os segredos com `openssl rand -hex 32`) e **cópia
      offline do `.env` no gerenciador de senhas da IJ**. Sem ela, o backup não
      sobe numa VPS nova (as senhas dos bancos e as chaves estão só lá).
- [ ] **Backup off-site funcionando**: `rclone config` com um remote, `BACKUP_REMOTE`
      no `.env`, e `scripts/backup.sh` rodado à mão mostrando `off-site: rclone copy`.
      Sem isso o disco da VPS é ponto único de falha. **Não entrar em produção sem.**
- [ ] Crontab instalado (`crontab -l`), primeiro backup do cron no log.
- [ ] Teste de restore feito uma vez na VPS (§3).
- [ ] Número dedicado pareado (§5), webhook configurado, `GRUPO_JID` preenchido.
- [ ] Conta da OpenAI com crédito pré-pago, **auto-reload desligado** e
      `OPENAI_API_KEY` no `.env` (§10). O `deploy.sh` recusa se o provedor
      selecionado em `LLM_PROVEDOR` (padrão `openai`) estiver sem chave.
- [ ] Aviso de privacidade da IJ menciona a transferência internacional do
      texto das mensagens `#crm` ao provedor de LLM (§10, "LGPD").
- [ ] `NOTIFICATIONS_ENABLED=true` no `.env` da VPS **por último**, e `scripts/deploy.sh`.

## 0. Primeira instalação (VPS limpa)

Pré-requisitos: Linux com Docker Engine + plugin compose v2, `git`, `curl`,
`flock` (util-linux), `rclone` (off-site) e de preferência `qrencode` e `jq`;
usuário de deploy no grupo `docker`.

```bash
sudo git clone <url-do-repo> /opt/ij-crm && sudo chown -R "$USER" /opt/ij-crm
cd /opt/ij-crm
cp .env.prod.example .env && chmod 600 .env
# preencher: APP_DOMAIN, ACME_EMAIL e um `openssl rand -hex 32` para cada segredo
sudo mkdir -p /var/backups/ij-crm /var/log/ij-crm && sudo chown "$USER" /var/backups/ij-crm /var/log/ij-crm
scripts/deploy.sh --no-pull                       # 1º deploy (banco vazio: sem backup)
dc --profile ops run --rm migrate prisma db seed  # pipelines/fases do Pipefy (só na 1ª vez)

# Primeiro admin — a senha nunca vai na linha de comando (fica fora do `ps` e do histórico):
read -rs -p "Senha do admin (min 8): " ADMIN_SENHA && echo && export ADMIN_SENHA
dc --profile ops run --rm -e ADMIN_NOME="Nome" -e ADMIN_EMAIL=voce@ij.com -e ADMIN_SENHA \
  migrate tsx scripts/criar-admin.ts
unset ADMIN_SENHA

crontab deploy/crontab.example   # substitui o crontab do usuário; confira com crontab -l
```

Depois: parear o WhatsApp (§5) e fechar o checklist acima.

> `docker compose -f compose.prod.yml up -d` sozinho também sobe a stack (e
> reinícios usam `restart: unless-stopped`), mas **não** roda migrations: elas
> são passo explícito do `deploy.sh`, nunca no boot do app.

## 1. Deploy

```bash
cd /opt/ij-crm && scripts/deploy.sh
```

O script, na ordem:

1. recusa se `git status --porcelain` mostrar qualquer coisa (mudança ou arquivo
   não rastreado). `--force` aceita, avisando que a imagem leva o que está no disco;
2. `git pull --ff-only` e re-executa a versão nova do próprio script;
3. confere o ambiente **como o compose resolve** (`docker compose config
   --environment`: `.env` + variáveis do shell): segredos com ≥ 32 caracteres e
   sem `troque-me`, senhas de banco/Redis seguras para URL, domínio e email
   preenchidos, e a chave do provedor de LLM selecionado (§10). Erro aborta antes de mexer em algo. Avisa se `NOTIFICATIONS_ENABLED` ≠ `true`;
4. build de `ij-crm/app:<commit>` (runtime) e `ij-crm/ops:<commit>`;
5. **backup sempre que o banco já tem dados** (existe `_prisma_migrations`);
6. `prisma migrate deploy` no container one-shot `migrate`. Se falhar, para aqui:
   o app antigo segue no ar e o script mostra o dump do passo 5 (§2, "Migration falhou");
7. `up -d --wait` com a imagem nova (espera todos os healthchecks) e
   `GET https://APP_DOMAIN/api/health` pelo Caddy (TLS de verdade) = 200;
8. sucesso: registra a tag em `.deploy/historico` e marca `:latest`.
   **Falha no passo 7: rollback automático** do app para o último deploy bom
   do histórico e saída com erro (o schema não volta; ver §2).

Comandos úteis: `dc ps` (estado + health), `dc logs -f app`,
`cat .deploy/historico` (deploys bons em ordem; o último é o "último bom").

Depois de um rollback automático confira `dc ps`: ele só troca o `app`. Se o
que falhou foi outro serviço (ex.: a Evolution não subiu), ele segue com o
problema. Veja `dc logs <serviço>`.

## 2. Rollback

```bash
scripts/deploy.sh rollback          # um passo para trás no histórico, a partir do que está rodando
scripts/deploy.sh rollback <tag>    # tag específica (ver .deploy/historico ou docker image ls ij-crm/app)
```

Sem tag: lê a tag do container `app` que está rodando e volta para o deploy bom
**anterior a ela** no histórico. Rollbacks seguidos vão andando para trás. Se o
que roda não está no histórico (deploy que falhou), volta para o último bom.
Recusa quando já está no mais antigo, quando o alvo é o que já roda e quando a
imagem do alvo não existe mais no host. Troca só o `app` (sem build) e confere
o health. O rollback não reescreve o histórico; `:latest` passa a apontar para o
que ficou rodando.

**O schema do banco não volta.** Migrations deste projeto devem ser aditivas (o
código antigo roda com colunas novas). Se a migration do deploy quebrou o código
antigo, restaure o dump que o próprio deploy fez antes de migrar (§3) e então
rode o rollback.

### Migration falhou

O deploy para antes de trocar o app: **a versão antiga segue no ar**. A saída
mostra o caminho do dump feito logo antes. O Prisma marca a migration como
falhada em `_prisma_migrations` e recusa as próximas (`P3009`) até alguém decidir:

```bash
dc logs --tail 100 migrate 2>/dev/null; dc exec db psql -U ijcrm -d ijcrm \
  -c "select migration_name, started_at, finished_at, logs from _prisma_migrations where finished_at is null"
```

- A migration não aplicou nada (erro logo no início, Postgres desfez o comando):
  corrija o SQL num commit novo, marque a antiga como desfeita e faça deploy de novo:
  `dc --profile ops run --rm migrate prisma migrate resolve --rolled-back <nome>`.
- Aplicou parte e o banco ficou inconsistente: restaure o dump mostrado pelo
  deploy (§3) e só então corrija e faça deploy de novo.

Limpeza de imagens antigas (manter as últimas ~5 tags para rollback):
`docker image ls ij-crm/app` → `docker image rm ij-crm/app:<tag> ij-crm/ops:<tag>`.

## 3. Restaurar backup

Backups ficam em `/var/backups/ij-crm` (cron diário 06:15 UTC, mais um a cada
deploy e a cada restore): `ijcrm-<UTC>.dump`, formato custom do `pg_dump`, 14
dias de retenção, no disco e no `BACKUP_REMOTE` (off-site). Log em
`/var/log/ij-crm/backup.log`.

```bash
ls -lt /var/backups/ij-crm | head
# (VPS nova: primeiro `rclone copy "$BACKUP_REMOTE/ijcrm-<UTC>.dump" /var/backups/ij-crm/`)
scripts/restore.sh /var/backups/ij-crm/ijcrm-20261024T061500Z.dump
# digite "restaurar" quando pedir
```

O script:

- recusa o arquivo se o nome não for `ijcrm-*.dump` ou se o índice do dump
  (`pg_restore --list`) não tiver as tabelas do CRM (`oportunidade`, `fase`,
  `usuario`, `_prisma_migrations`);
- faz um backup de segurança do estado atual e para o `app`;
- roda `pg_restore --clean --if-exists --no-owner --single-transaction`. Se
  falhar, a transação é desfeita e nada muda;
- roda `prisma migrate deploy` (one-shot, mesma tag do app). Um dump antigo
  pode estar atrás das migrations que a imagem atual espera;
- sobe o `app` e espera o health.

Sessões voltam junto com o dump: quem logou depois do backup precisa logar de novo.

**O banco e o Redis da Evolution não entram no backup** (decisão do GAB-30).
Eles guardam a sessão do WhatsApp (credenciais e chaves Signal do Baileys) e
config da instância, nada do CRM. Num desastre (VPS nova, volumes perdidos), o
caminho é parear de novo: §5 inteiro (criar instância → QR → webhook → conferir
`GRUPO_JID`). Restaurar só o banco do CRM numa VPS que ainda tem os volumes da
Evolution não mexe no WhatsApp.

Teste de restore (rodar a cada poucos meses; foi executado no GAB-30): restaurar
o dump mais recente, conferir contagens (`dc exec db psql -U ijcrm -d ijcrm -c
'select count(*) from oportunidade'`) e abrir o Kanban.

## 4. Trocar o número do bot

O número é só a sessão do WhatsApp na instância da Evolution. O CRM guarda o
JID do **grupo** (`GRUPO_JID`), não o número do bot.

```bash
scripts/evolution.sh logout   # desconecta o número antigo
scripts/evolution.sh qr       # parear com o celular do número NOVO (§5)
scripts/evolution.sh estado   # "open" = conectado
# no WhatsApp: adicionar o número novo ao grupo de vendas (e remover o antigo)
scripts/evolution.sh grupos   # conferir que o JID do grupo é o mesmo de GRUPO_JID
```

O webhook é da instância e continua configurado. Se o grupo mudou (grupo novo),
atualize `GRUPO_JID` no `.env` e rode `scripts/deploy.sh`. Teste mandando uma
mensagem `#crm` no grupo e conferindo a confirmação.

## 5. Ler o QR da Evolution (criar/reconectar a instância)

A Evolution não tem rota pública: a porta dela fica só em `127.0.0.1:8080` da
VPS (`EVOLUTION_HOST_PORT`). Tudo abaixo roda **na VPS** com
`scripts/evolution.sh`, que lê chave e segredos do `.env` e nunca os põe na
linha de comando do curl (headers e corpo em arquivos de um diretório privado
`umask 077`, apagado na saída).

```bash
scripts/evolution.sh criar     # 1ª vez: cria a instância EVOLUTION_INSTANCE
scripts/evolution.sh qr        # QR no terminal (com qrencode) — escaneie: WhatsApp → Dispositivos conectados
scripts/evolution.sh estado    # "open" = conectado (o QR expira em segundos; rode `qr` de novo se precisar)
scripts/evolution.sh webhook   # 1ª vez: webhook → http://app:3000/api/webhooks/evolution, header x-webhook-secret
scripts/evolution.sh grupos    # JID do grupo de vendas → GRUPO_JID no .env, depois scripts/deploy.sh
```

Sem `qrencode`, o `qr` grava o PNG num diretório `~/.ij-crm.XXXX` com permissão
só do dono e **apaga ao apertar Enter**. Se precisar copiar para ver,
`scp` para a sua máquina e apague a cópia logo depois.

Alternativa visual (manager web da Evolution), por túnel SSH a partir da sua máquina:

```bash
ssh -N -L 8080:127.0.0.1:8080 usuario@vps     # deixe aberto
# navegador: http://localhost:8080/manager → login com a EVOLUTION_API_KEY (do gerenciador de senhas)
```

Autenticação do webhook em produção: **só** o header `x-webhook-secret`
(= `EVOLUTION_WEBHOOK_SECRET`, configurado em `webhook.headers` pelo `evolution.sh
webhook`; a v2.3.7 envia esses headers, confirmado no código-fonte). O fallback do
README (campo `apikey` no corpo) fica desligado em prod:
`AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false` faz a Evolution mandar `apikey: null`.
Se o header não chegar, o webhook responde 401. Teste com uma mensagem `#crm` logo
depois de configurar.

O que a Evolution guarda (v2.3.7, lido no código): `evolution-db` tem instância,
webhook e credenciais do Baileys; o Redis (AOF, senha) tem as chaves Signal da
sessão, marcadores de dedup (`jid_timestamp`, 5 min), ids de mensagens editadas
(24h) e metadados de grupo (nome e JIDs dos participantes). Nenhum corpo de
mensagem: `DATABASE_SAVE_DATA_*=false`, e `LOG_LEVEL=ERROR,WARN` desliga os níveis
`VERBOSE` (corpo da mensagem) e `WEBHOOKS` (payload).

## 6. `NOTIFICATIONS_ENABLED` vazou para dev

Regra: `NOTIFICATIONS_ENABLED=true` existe **só** no `.env` da VPS (o
`.env.prod.example` vem com `false`). Em qualquer outro lugar (`.env` de dev, CI,
`compose.yml`) fica ausente. Sem ela o bot só loga `[SAFE MODE] WhatsApp NÃO enviado ...`.

Sintoma: alguém rodando local fez o bot mandar mensagem de verdade (no grupo
real, se a Evolution local estiver logada num número real).

1. **Parar o envio agora** na máquina que vazou: `docker compose stop app` ou
   matar o `pnpm dev`. Se não souber qual máquina, desconecte a instância de
   dev pela Evolution de dev (`POST`/`DELETE /instance/logout/<instancia>` com a apikey de dev).
2. Tirar a variável: apagar/comentar a linha no `.env` daquela máquina e
   conferir que não está exportada no shell (`env | grep NOTIFICATIONS`).
   Subir o app de novo e confirmar o log `[SAFE MODE]`.
3. Se a Evolution de dev estava logada no **número de produção**, o problema é
   maior: dois clientes na mesma sessão. Faça logout lá e confira na VPS
   `scripts/evolution.sh estado` = `open`. Se caiu, pareie de novo (§5).
4. Avaliar o estrago: o que foi enviado e para quem (logs do app de dev). Se
   saiu mensagem estranha no grupo de vendas, avise o grupo que foi teste.
5. Se o `.env` de produção (ou cópia dele) foi parar em dev, trate os segredos
   como vazados: gere novos (`openssl rand -hex 32`) para `EVOLUTION_API_KEY`,
   `EVOLUTION_WEBHOOK_SECRET`, `CRON_SECRET` e rode `scripts/deploy.sh`, depois
   `scripts/evolution.sh webhook` (novo segredo no header). Atualize a cópia
   offline do `.env`.

## 7. Cron do host

`deploy/crontab.example`:

- `06:15 UTC`: `scripts/backup.sh` → `/var/log/ij-crm/backup.log`
- a cada 10 min: `scripts/cron-reprocessar.sh` → `/var/log/ij-crm/cron.log`

`cron-reprocessar.sh` chama `POST https://APP_DOMAIN/api/cron/reprocessar` pelo
Caddy, com `--resolve` para 127.0.0.1 e o header `x-cron-secret: $CRON_SECRET`
(passado pelo stdin do curl, não aparece em `ps`). O log tem **só horário e
status HTTP**: o corpo da resposta é descartado. **A rota é do GAB-41 e ainda
não existe**: até lá cada execução registra `HTTP 404`, o que é esperado e sem efeito.

Contrato para o GAB-41:

- **o header `x-cron-secret` é o único controle de acesso** de `/api/cron/*`. O
  app deve validá-lo com a regra de `src/lib/config/env.ts` (≥ 32 chars, sem
  `troque-me`, comparação em tempo constante) e falhar fechado;
- a resposta deve trazer só contagens (ex.: `{"reprocessadas":3,"falhas":0}`),
  nunca conteúdo de mensagem nem dado pessoal.

O Caddy responde 404 para `/api/cron/*` vindo de IP público. Isso é **defesa em
profundidade, não controle**: corta ruído óbvio, mas não é confiável (com o
docker-proxy, um cliente externo por IPv6 chega com IP privado da bridge).

## 8. Teste local da stack de produção

Sem VPS: usa a CA interna do Caddy para `localhost` em portas altas e outro nome
de projeto, sem encostar no compose de dev.

```bash
cat > /tmp/env.prodtest <<EOF
APP_DOMAIN=localhost
ACME_EMAIL=teste@example.com
HTTP_PORT=8081
HTTPS_PORT=8443
EVOLUTION_HOST_PORT=18080
POSTGRES_PASSWORD=$(openssl rand -hex 32)
EVOLUTION_DB_PASSWORD=$(openssl rand -hex 32)
EVOLUTION_REDIS_PASSWORD=$(openssl rand -hex 32)
EVOLUTION_API_KEY=$(openssl rand -hex 32)
EVOLUTION_WEBHOOK_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
NOTIFICATIONS_ENABLED=false
EOF
export COMPOSE_PROJECT_NAME=ijcrm-prodtest COMPOSE_ENV_FILES=/tmp/env.prodtest \
       APP_IMAGE=ijcrm-prodtest/app OPS_IMAGE=ijcrm-prodtest/ops BACKUP_DIR=/tmp/ijcrm-backups
CURL_INSECURE=1 scripts/deploy.sh --no-pull     # 1ª vez: a CA interna ainda não existe no host
docker compose -f compose.prod.yml --env-file /tmp/env.prodtest exec -T caddy \
  cat /data/caddy/pki/authorities/local/root.crt > /tmp/caddy-root.crt
export CURL_CACERT=/tmp/caddy-root.crt
curl --cacert "$CURL_CACERT" https://localhost:8443/api/health
scripts/backup.sh
RESTORE_CONFIRMAR=restaurar scripts/restore.sh "$(ls -1t /tmp/ijcrm-backups/ijcrm-*.dump | head -n 1)"
scripts/evolution.sh criar && scripts/evolution.sh webhook && scripts/evolution.sh estado
docker compose -f compose.prod.yml --env-file /tmp/env.prodtest --profile ops down -v   # limpa tudo do teste
rm -rf .deploy   # histórico de deploy do teste
```

Cada build gera imagens `ops` de ~1,9 GB (camadas compartilhadas) e cache de
build: no fim, `docker image rm` das tags `ijcrm-prodtest/*`.

## 9. IP do cliente e limitadores (login / "esqueci a senha")

Os limitadores de tentativa (`src/lib/auth/limitador.ts`) identificam o cliente
pelo **último** item do `X-Forwarded-For` (`src/lib/auth/ip.ts`). Isso só é
confiável porque o Caddy é a única coisa na frente do app: o `compose.prod.yml`
publica só as portas do Caddy, e o app não é exposto. O Caddy anexa ao fim do
header o IP de quem abriu a conexão. Tudo o que vem antes foi enviado pelo
cliente e pode ser forjado.

- **Não** publique a porta 3000 do app nem coloque o app atrás de outro proxy
  sem passar pelo Caddy. Quem falar direto com o app escolhe o próprio "IP".
- Se algum dia entrar um CDN/proxy **na frente** do Caddy (Cloudflare etc.), o
  último hop passa a ser o IP desse proxy, e todos os clientes caem na mesma
  chave. Antes disso: configure `trusted_proxies` no Caddy e revise `ipDoCliente`.
- Os contadores ficam em memória, com teto de 10 mil chaves por limitador.
  Reiniciar o container zera todos.

## 10. Provedor de LLM e crédito da OpenAI

Produção usa **OpenAI, GPT-6.1 Sol com raciocínio `low`** (`LLM_PROVEDOR=openai`,
padrão). A Anthropic (Claude Haiku 5.5) segue como alternativa por env.

**Trocar de provedor** (no `.env` da VPS, depois `scripts/deploy.sh`, que recria o
app com o env novo):

```bash
# OpenAI (padrão)
LLM_PROVEDOR=openai
OPENAI_API_KEY=sk-...
LLM_EXTRACAO_MODELO=          # vazio = gpt-6.1-sol

# Anthropic (alternativa)
LLM_PROVEDOR=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LLM_EXTRACAO_MODELO=          # vazio = claude-haiku-5-5 (ou claude-sonnet-5-5)
```

Troque ou esvazie `LLM_EXTRACAO_MODELO` junto: modelo de um provedor com o outro
selecionado faz toda mensagem ir para `FALHA` com "PROVEDOR_INVALIDO" (ref no
grupo e motivo em Gestão → mensagens). Depois da troca, reprocesse as `FALHA` do
período (o cron do GAB-41 faz isso sozinho).

**Crédito pré-pago, recarga manual** (platform.openai.com → Settings → Billing):

1. Na configuração da conta, **desligue o auto-reload** (auto recharge). A conta
   fica só com o saldo comprado: nunca cobra o cartão sem alguém decidir.
2. Compra mínima: **US$ 5**. Créditos **expiram 1 ano** depois da compra —
   não compre muito adiantado.
3. Sugestão para o volume da IJ: **US$ 50 a cada ~3 meses**. Confira o uso em
   Usage e o custo real nos logs (`[llm] extracao ... tokens_in= tokens_out=
   tokens_reasoning=`).
4. Crie uma chave de **projeto** só para o CRM (Settings → API keys) e guarde a
   cópia offline junto com o `.env`.

**Saldo acabou:** a API responde `insufficient_quota` (ou
`credit_balance_exhausted`), identificado pelo código do erro — nunca pelo texto.
Cada mensagem `#crm` vai para `FALHA` com "sem crédito na API da OpenAI" + ref
(sem re-tentar, sem gastar), e o grupo recebe "❌ ... (ref: ...)". Recarregue e as
mensagens voltam pelo reprocessamento (GAB-41, mantendo `erro`).

**LGPD — transferência internacional.** O texto das mensagens `#crm` vai para a
API do provedor de LLM, nos EUA (OpenAI; antes, igualmente, Anthropic). Só vai o
que chega à LLM: mensagens do grupo configurado marcadas com `#crm`, com o
contexto mínimo (nomes/ids de candidatos e fases). A chamada usa `store: false`
(a OpenAI não guarda a resposta para consulta) e nenhum log do CRM grava o texto
da mensagem nem o texto devolvido pela API. O aviso de privacidade da IJ deve
mencionar essa transferência ao provedor de LLM — decisão jurídica do usuário.
