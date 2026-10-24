# Runbook de produção — ij-crm

Operação da VPS (GAB-30). Stack: `compose.prod.yml` com `caddy` (únicas portas
publicadas: 80/443), `app`, `db` (Postgres 16), `evolution` + `evolution-db` +
`evolution-redis`, e o one-shot `migrate` (perfil `ops`). Repo em `/opt/ij-crm`.

Atalho usado em todo este documento (rode na raiz do repo):

```bash
alias dc='docker compose -f compose.prod.yml'
```

| Arquivo | Para quê |
|---|---|
| `scripts/deploy.sh` | deploy (`pull → build → backup → migrate → up → health`) e `rollback` |
| `scripts/backup.sh` | `pg_dump` dos dois bancos, retenção de 14 dias |
| `scripts/restore.sh` | restaura um dump do CRM (destrutivo, pede confirmação) |
| `scripts/cron-reprocessar.sh` | `POST /api/cron/reprocessar` com o segredo no header |
| `deploy/crontab.example` | crontab do host (backup diário + reprocessar a cada 10 min) |
| `.env.prod.example` | todas as variáveis de produção |

---

## 0. Primeira instalação (VPS limpa)

Pré-requisitos: Linux com Docker Engine + plugin compose v2, `git`, `curl`,
`flock` (util-linux); usuário de deploy no grupo `docker`; portas 80/443
abertas no firewall; DNS `A`/`AAAA` de `APP_DOMAIN` **e** `EVOLUTION_DOMAIN`
apontando para a VPS (sem isso o Let's Encrypt não emite).

```bash
sudo git clone <url-do-repo> /opt/ij-crm && sudo chown -R "$USER" /opt/ij-crm
cd /opt/ij-crm
cp .env.prod.example .env && chmod 600 .env
# preencher: domínios, ACME_EMAIL e um `openssl rand -hex 32` para cada segredo
scripts/deploy.sh --no-pull                       # 1º deploy (sem backup: não há dados)
dc --profile ops run --rm migrate prisma db seed  # pipelines/fases do Pipefy (só na 1ª vez)
dc --profile ops run --rm \
  -e ADMIN_NOME="Nome" -e ADMIN_EMAIL=voce@ij.com -e ADMIN_SENHA='min 8 chars' \
  migrate tsx scripts/criar-admin.ts              # primeiro admin
# cron do host
sudo mkdir -p /var/backups/ij-crm /var/log/ij-crm && sudo chown "$USER" /var/backups/ij-crm /var/log/ij-crm
crontab deploy/crontab.example                    # substitui o crontab do usuário; confira com crontab -l
```

Depois: ler o QR e configurar a instância da Evolution (§5).

> `docker compose -f compose.prod.yml up -d` sozinho também sobe a stack (e
> reinícios usam `restart: unless-stopped`), mas **não** roda migrations: elas
> são passo explícito do `deploy.sh`, nunca no boot do app.

## 1. Deploy

```bash
cd /opt/ij-crm && scripts/deploy.sh
```

O script, na ordem:

1. confere o `.env` — segredos com ≥ 32 caracteres e sem `troque-me`, senhas de
   banco seguras para URL, domínios preenchidos. Qualquer erro aborta antes de
   mexer em algo. Avisa se `NOTIFICATIONS_ENABLED` não for `true`;
2. `git pull --ff-only` e re-executa a versão nova do próprio script;
3. build das imagens `ij-crm/app:<commit>` (runtime) e `ij-crm/ops:<commit>`;
4. backup (`scripts/backup.sh`) se já houve deploy antes;
5. `prisma migrate deploy` no container one-shot `migrate`;
6. `up -d --wait` com a imagem nova: espera todos os healthchecks;
7. `GET https://APP_DOMAIN/api/health` pelo Caddy (TLS de verdade) = 200;
8. registra a tag em `.deploy/historico` e marca `:latest`.

Se o passo 7 falhar, o deploy **não** é registrado e o script sai com erro:
veja `dc logs --tail 200 app caddy` e faça rollback (§2).

Comandos úteis: `dc ps` (estado + health), `dc logs -f app`,
`cat .deploy/historico` (tags, a última é a atual).

## 2. Rollback

```bash
scripts/deploy.sh rollback          # volta para a anterior (ou para a última boa, se o deploy falhou no health)
scripts/deploy.sh rollback <tag>    # tag específica (ver .deploy/historico ou docker image ls ij-crm/app)
```

Troca só o container `app` (imagem já existe no host, sem build) e confere o
health. **O schema do banco não volta.** Migrations deste projeto devem ser
aditivas (o código antigo roda com colunas novas); se a migration do deploy
quebrou o código antigo, restaure o backup feito pelo próprio deploy (passo 4,
o `ijcrm-*.dump` mais recente antes do horário do deploy) — §3 — e então rode
o rollback.

Limpeza de imagens antigas (manter as últimas ~5 tags para rollback):
`docker image ls ij-crm/app` → `docker image rm ij-crm/app:<tag> ij-crm/ops:<tag>`.

## 3. Restaurar backup

Backups ficam em `/var/backups/ij-crm` (cron diário 06:15 UTC + um a cada
deploy): `ijcrm-<UTC>.dump` (CRM) e `evolution-<UTC>.dump` (Evolution), formato
custom do `pg_dump`, 14 dias de retenção. Log: `/var/log/ij-crm/backup.log`.

> Os dumps ficam **no mesmo disco** da VPS. Cópia off-site (rclone/S3/outro
> host) é pendência — ver "Pendências" no fim.

```bash
ls -lt /var/backups/ij-crm | head
scripts/restore.sh /var/backups/ij-crm/ijcrm-20261024T061500Z.dump
# digite "restaurar" quando pedir
```

O script valida o dump (`pg_restore --list`), faz um backup de segurança do
estado atual, para o `app`, roda `pg_restore --clean --if-exists --no-owner
--single-transaction` (se falhar, nada muda) e sobe o app esperando o health.
Sessões voltam junto com o dump: quem logou depois do backup precisa logar de novo.

Teste de restore (rodar a cada poucos meses; foi executado no GAB-30): restaurar
o dump mais recente, conferir contagens (`dc exec db psql -U ijcrm -d ijcrm -c
'select count(*) from oportunidade'`) e abrir o Kanban.

Restaurar o banco da Evolution (raro — perder o banco dela só obriga a ler o QR
de novo):

```bash
dc stop evolution
dc exec -T evolution-db pg_restore -U evolution -d evolution --clean --if-exists --no-owner \
  --single-transaction < /var/backups/ij-crm/evolution-<UTC>.dump
dc start evolution
```

## 4. Trocar o número do bot

O número é só a sessão do WhatsApp na instância da Evolution; o CRM guarda o
JID do **grupo** (`GRUPO_JID`), não o número do bot.

```bash
set -a; source .env; set +a      # $EVOLUTION_API_KEY, $EVOLUTION_DOMAIN, etc.
EVO="https://$EVOLUTION_DOMAIN"
# 1. desconectar o número antigo
curl -s -X DELETE "$EVO/instance/logout/$EVOLUTION_INSTANCE" -H "apikey: $EVOLUTION_API_KEY"
# 2. ler o QR com o celular do número NOVO (§5, passo 2)
# 3. no WhatsApp: adicionar o número novo ao grupo de vendas (e remover o antigo)
# 4. conferir que o JID do grupo é o mesmo de GRUPO_JID (§5, passo 4)
```

O webhook é da instância e continua configurado. Se o grupo mudou (grupo novo),
atualize `GRUPO_JID` no `.env` e rode `dc up -d app`. Teste mandando uma
mensagem `#crm` no grupo e verificando a confirmação.

## 5. Ler o QR da Evolution (criar/reconectar a instância)

```bash
set -a; source .env; set +a
EVO="https://$EVOLUTION_DOMAIN"

# 1. criar a instância (só na 1ª vez). token = EVOLUTION_API_KEY de propósito (fallback de auth do webhook)
curl -s -X POST "$EVO/instance/create" -H "apikey: $EVOLUTION_API_KEY" -H 'content-type: application/json' \
  -d "{\"instanceName\":\"$EVOLUTION_INSTANCE\",\"token\":\"$EVOLUTION_API_KEY\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}"

# 2. QR: abra https://$EVOLUTION_DOMAIN/manager e entre com a EVOLUTION_API_KEY,
#    ou gere um PNG e copie para a sua máquina (scp) para escanear:
curl -s "$EVO/instance/connect/$EVOLUTION_INSTANCE" -H "apikey: $EVOLUTION_API_KEY" \
  | jq -r .base64 | sed 's/^data:image\/png;base64,//' | base64 -d > /tmp/qr.png
# Celular: WhatsApp → Dispositivos conectados → Conectar dispositivo. O QR expira em segundos: gere de novo se precisar.
curl -s "$EVO/instance/connectionState/$EVOLUTION_INSTANCE" -H "apikey: $EVOLUTION_API_KEY"   # "open" = conectado
rm -f /tmp/qr.png

# 3. webhook (só na 1ª vez): rede interna, o app é http://app:3000
curl -s -X POST "$EVO/webhook/set/$EVOLUTION_INSTANCE" -H "apikey: $EVOLUTION_API_KEY" -H 'content-type: application/json' \
  -d "{\"webhook\":{\"enabled\":true,\"url\":\"http://app:3000/api/webhooks/evolution\",\"byEvents\":false,\"base64\":false,
       \"headers\":{\"x-webhook-secret\":\"$EVOLUTION_WEBHOOK_SECRET\"},\"events\":[\"MESSAGES_UPSERT\"]}}"

# 4. JID do grupo de vendas → GRUPO_JID no .env, depois `dc up -d app`
curl -s "$EVO/group/fetchAllGroups/$EVOLUTION_INSTANCE?getParticipants=false" -H "apikey: $EVOLUTION_API_KEY" \
  | jq -r '.[] | "\(.id)\t\(.subject)"'
```

Sem `jq` na VPS: `sudo apt install jq`. Detalhes de autenticação do webhook e
re-tentativas: README, seção WhatsApp.

## 6. `NOTIFICATIONS_ENABLED` vazou para dev

Regra: `NOTIFICATIONS_ENABLED=true` existe **só** no `.env` da VPS. Em qualquer
outro lugar (`.env` de dev, CI, `compose.yml`) fica ausente — sem ela o bot só
loga `[SAFE MODE] WhatsApp NÃO enviado ...`.

Sintoma: alguém rodando local fez o bot mandar mensagem de verdade (no grupo
real, se a Evolution local estiver logada num número real).

1. **Parar o envio agora** na máquina que vazou: `docker compose stop app` ou
   matar o `pnpm dev`. Se não souber qual máquina, desconecte a instância de
   dev: `curl -X DELETE <evolution-dev>/instance/logout/<instancia> -H "apikey: ..."`.
2. Tirar a variável: apagar/comentar a linha no `.env` daquela máquina e
   conferir que não está exportada no shell (`env | grep NOTIFICATIONS`).
   Subir o app de novo e confirmar o log `[SAFE MODE]`.
3. Se a Evolution de dev estava logada no **número de produção**, isso é o
   problema maior: dois clientes na mesma sessão. Faça logout lá e confira em
   produção `connectionState` = `open`; se caiu, leia o QR de novo (§5).
4. Avaliar o estrago: o que foi enviado e para quem (logs do app de dev). Se
   saiu mensagem estranha no grupo de vendas, avise o grupo que foi teste.
5. Se o `.env` de produção (ou cópia dele) foi parar em dev, trate os segredos
   como vazados: gere novos (`openssl rand -hex 32`) para `EVOLUTION_API_KEY`,
   `EVOLUTION_WEBHOOK_SECRET`, `CRON_SECRET` e rode `scripts/deploy.sh`. Trocar
   `EVOLUTION_API_KEY` exige também atualizar o `token` da instância e o webhook (§5).

## 7. Cron do host

`deploy/crontab.example`:

- `06:15 UTC` — `scripts/backup.sh` → `/var/log/ij-crm/backup.log`
- a cada 10 min — `scripts/cron-reprocessar.sh` → `/var/log/ij-crm/cron.log`

`cron-reprocessar.sh` chama `POST https://APP_DOMAIN/api/cron/reprocessar` pelo
Caddy, com `--resolve` para 127.0.0.1 e o header `x-cron-secret: $CRON_SECRET`
(passado pelo stdin do curl, não aparece em `ps`). **A rota é do GAB-41 e ainda
não existe**: até lá cada execução registra `404` no log — esperado, sem efeito.
O GAB-41 deve ler o header `x-cron-secret` e aplicar a regra de segredo de
`src/lib/config/env.ts` (≥ 32 chars, sem `troque-me`).

O Caddy responde 404 para `/api/cron/*` vindo de IP público (defesa em
profundidade; a chamada do host chega pela bridge do Docker, IP privado). O
segredo continua sendo a proteção principal.

## 8. Teste local da stack de produção

Sem VPS: usa a CA interna do Caddy para `localhost` / `evolution.localhost`
em portas altas e outro nome de projeto, sem encostar no compose de dev.

```bash
cat > /tmp/env.prodtest <<EOF
APP_DOMAIN=localhost
EVOLUTION_DOMAIN=evolution.localhost
ACME_EMAIL=teste@example.com
HTTP_PORT=8081
HTTPS_PORT=8443
POSTGRES_PASSWORD=$(openssl rand -hex 32)
EVOLUTION_DB_PASSWORD=$(openssl rand -hex 32)
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
curl --cacert /tmp/caddy-root.crt https://localhost:8443/api/health
CURL_CACERT=/tmp/caddy-root.crt scripts/backup.sh
RESTORE_CONFIRMAR=restaurar CURL_CACERT=/tmp/caddy-root.crt \
  scripts/restore.sh "$(ls -1t /tmp/ijcrm-backups/ijcrm-*.dump | head -n 1)"
docker compose -f compose.prod.yml --env-file /tmp/env.prodtest down -v   # limpa tudo do teste
rm -rf .deploy   # histórico de deploy do teste
```

## Pendências (dependem da VPS / do usuário)

- Contratar a VPS, apontar DNS dos dois domínios, abrir 80/443.
- Cópia off-site dos backups (o disco da VPS é ponto único de falha).
- Número de WhatsApp dedicado → §5.
- Rota `/api/cron/reprocessar` (GAB-41).
