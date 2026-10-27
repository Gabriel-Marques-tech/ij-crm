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
| `scripts/deploy.sh` | deploy (`checa → git pull → docker pull da imagem → backup → migrate → up → health`) e `rollback` por tag |
| `.github/workflows/imagens.yml` | CI: builda as imagens `app` e `ops` a cada push na `main` e publica no GHCR |
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
usuário de deploy no grupo `docker`. Instância mínima e swap: §11.

As imagens vêm prontas do GHCR (`ghcr.io/gabriel-marques-tech/ij-crm-app` e
`…-ops`, buildadas pelo CI): a VPS **não builda**. Se os pacotes forem privados
(padrão do GHCR para pacote novo), faça login uma vez com um PAT clássico só de
leitura. No GitHub: Settings → Developer settings → Personal access tokens →
Tokens (classic) → escopo **apenas** `read:packages`. Na VPS:

```bash
read -rs -p "PAT read:packages: " GHCR_PAT && echo
printf '%s' "$GHCR_PAT" | docker login ghcr.io -u <usuario-github> --password-stdin
unset GHCR_PAT    # credencial fica em ~/.docker/config.json (chmod 600)
```

Pacotes públicos (Package settings → Change visibility → Public) dispensam o login.

```bash
sudo git clone <url-do-repo> /opt/ij-crm && sudo chown -R "$USER" /opt/ij-crm
cd /opt/ij-crm
cp .env.prod.example .env && chmod 600 .env
# preencher: APP_DOMAIN, ACME_EMAIL e um `openssl rand -hex 32` para cada segredo
sudo mkdir -p /var/backups/ij-crm /var/log/ij-crm && sudo chown "$USER" /var/backups/ij-crm /var/log/ij-crm
scripts/deploy.sh --no-pull                       # 1º deploy: baixa :latest do GHCR (banco vazio: sem backup)
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

Fluxo: merge na `main` → o workflow **imagens** (GitHub Actions) builda e publica
`ij-crm-app` e `ij-crm-ops` com as tags `sha-<commit curto>` e `latest` (≈ 5–10
min; acompanhe na aba Actions) → deploy na VPS:

```bash
cd /opt/ij-crm && scripts/deploy.sh                 # a imagem :latest (resolvida para o sha-… dela)
scripts/deploy.sh sha-1a2b3c4                       # uma tag específica (ver Actions ou o GHCR)
scripts/deploy.sh --build-local                     # escape: sem CI/registry, builda NESTA máquina
```

`--build-local` gera `local-<commit>` com `docker compose build` na própria VPS:
precisa de ~2 GB de RAM livres e alguns GB de disco de cache. Numa instância de
2 GB, pare o app ou use swap. Só para emergência (GitHub fora, CI quebrado).

O script, na ordem:

1. recusa se `git status --porcelain` mostrar qualquer coisa (mudança ou arquivo
   não rastreado). `--force` aceita;
2. `git pull --ff-only` (traz `compose.prod.yml`, `Caddyfile` e scripts) e
   re-executa a versão nova do próprio script;
3. confere o ambiente **como o compose resolve** (`docker compose config
   --environment`: `.env` + variáveis do shell): segredos com ≥ 32 caracteres e
   sem `troque-me`, senhas de banco/Redis seguras para URL, domínio e email
   preenchidos, e a chave do provedor de LLM selecionado (§10). Erro aborta antes de mexer em algo. Avisa se `NOTIFICATIONS_ENABLED` ≠ `true`;
4. `docker pull` das imagens `app` e `ops` da tag. `latest` é resolvida para a
   tag imutável `sha-<commit>` (label `org.opencontainers.image.revision` que o CI
   grava), então histórico e rollback nunca dependem de `latest`. Falha no pull
   (tag não existe, sem `docker login`) aborta antes de mexer em algo;
5. **backup sempre que o banco já tem dados** (existe `_prisma_migrations`);
6. `prisma migrate deploy` no container one-shot `migrate`. Se falhar, para aqui:
   o app antigo segue no ar e o script mostra o dump do passo 5 (§2, "Migration falhou");
7. `up -d --wait` com a imagem nova (espera todos os healthchecks) e
   `GET https://APP_DOMAIN/api/health` pelo Caddy (TLS de verdade) = 200;
8. sucesso: registra a tag em `.deploy/historico` e em `.deploy/atual`, marca `:latest` local e apaga
   as imagens `app`/`ops` fora das últimas `IMAGENS_MANTER` (padrão 5) tags do
   histórico, mais as camadas órfãs.
   **Falha no passo 7: rollback automático** do app para a tag de
   `.deploy/atual` (o último deploy **ou rollback** bom: depois de um rollback
   manual, volta para onde o operador deixou, não para a versão abandonada) e
   saída com erro (o schema não volta; ver §2).

Um deploy/rollback por vez: o script segura `flock` em `.deploy/lock` e o
segundo sai com "outro deploy/rollback em andamento". O comportamento do
script (incluindo o rollback automático) tem teste sem Docker:
`bash scripts/teste-deploy.sh`.

Comandos úteis: `dc ps` (estado + health), `dc logs -f app`,
`cat .deploy/historico` (deploys bons em ordem), `cat .deploy/atual` (a tag boa que deve estar rodando).

Depois de um rollback automático confira `dc ps`: ele só troca o `app`. Se o
que falhou foi outro serviço (ex.: a Evolution não subiu), ele segue com o
problema. Veja `dc logs <serviço>`.

## 2. Rollback

```bash
scripts/deploy.sh rollback          # um passo para trás no histórico, a partir do que está rodando
scripts/deploy.sh rollback sha-1a2b3c4   # tag específica (ver .deploy/historico ou as tags no GHCR)
```

Sem tag: lê a tag do container `app` que está rodando e volta para o deploy bom
**anterior a ela** no histórico. Rollbacks seguidos vão andando para trás. Se o
que roda não está no histórico (deploy que falhou), volta para o último bom.
A tag tem de ser `sha-…` ou `local-…` (`rollback latest` é recusado: o
`latest` local pode ser velho ou o que acabou de falhar). Rollback bem-sucedido
grava `.deploy/atual`. Recusa quando já está no mais antigo e quando o alvo é o que já roda. Se a
imagem do alvo não está mais no host (limpeza do deploy), baixa do GHCR; tags
`local-*` não existem no registry. Troca só o `app` (sem build) e confere o health. O rollback não reescreve o histórico; `:latest` passa a apontar para o
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

Limpeza de imagens antigas: automática no fim de cada deploy bom (últimas
`IMAGENS_MANTER` tags do histórico + a que roda). À mão:
`docker image ls ghcr.io/gabriel-marques-tech/ij-crm-app` → `docker image rm <imagem>:<tag>`.

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
status HTTP**: o corpo da resposta é descartado.

A rota (GAB-41, `src/app/api/cron/reprocessar/route.ts`):

- **o header `x-cron-secret` é o único controle de acesso** de `/api/cron/*`,
  validado com a regra de `src/lib/config/env.ts` (≥ 32 chars, sem `troque-me`,
  comparação em tempo constante). `CRON_SECRET` ausente/fraco ⇒ 401 para tudo e
  `[cron] CRON_SECRET inutilizável (…)` no log do app;
- uma execução por vez (trava por aluguel de linha em `trava_cron`, 9 min, sem
  segurar conexão do banco): se a anterior ainda roda, `200 {"ok":true,"emAndamento":true}`
  sem fazer nada. Se o app morrer no meio, a trava vence sozinha em 9 min;
- passos extras: resumos do contexto de 12 h (GAB-49: gera os da janela fechada,
  teto de 60 s, e apaga os antigos); mensagens **sem #crm** não confirmadas (`FALHA`/`PENDENTE_REVISAO`)
  com mais de 30 dias são apagadas; travadas que já gastaram 3 tentativas viram
  `FALHA` `TENTATIVAS_ESGOTADAS` (aparecem em Gestão → WhatsApp);
- passos: retenção de 90 dias do JSON da LLM, prévias de import vencidas,
  sessões expiradas e, por último, o reprocessamento (no máximo 20 mensagens,
  para no primeiro "sem crédito" de novo e não começa nada depois de 4 min);
- a resposta traz só contagens (`reprocessamento.tentadas`, `processadas`,
  `falhas`…) e, se algum passo falhou, `erros: [ref…]` com **HTTP 500** — o log
  do cron mostra `reprocessar HTTP 500`; `grep 'ref=<ref>'` no log do app acha a
  causa. Nunca conteúdo de mensagem nem dado pessoal.

Rodar na mão (mesmo efeito do cron): `scripts/cron-reprocessar.sh`. Mensagens que
esgotaram as 3 tentativas ficam em Gestão → WhatsApp para reprocessar ou
resolver manualmente.

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
# 1ª vez: a CA interna ainda não existe no host. --build-local builda o commit do disco;
# para testar as imagens do CI, tire APP_IMAGE/OPS_IMAGE e passe a tag (sha-…).
CURL_INSECURE=1 scripts/deploy.sh --no-pull --build-local
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

Cada build gera imagens `ops` de ~2 GB (camadas compartilhadas) e cache de
build: no fim, `docker image rm` das tags `ijcrm-prodtest/*` e `docker builder prune`.

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

## 10. Provedor de LLM e crédito da OpenAI / Gemini

O padrão do código é **OpenAI, GPT-6.1 Sol com raciocínio `low`**
(`LLM_PROVEDOR=openai`). Alternativas: Anthropic (Claude Haiku 5.5) e **Google
Gemini (Gemini 3.8 Flash, thinking `LOW`)** pela chave do Google AI Studio.

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

# Gemini (Google AI Studio)
LLM_PROVEDOR=gemini
GEMINI_API_KEY=AIza...
LLM_EXTRACAO_MODELO=          # vazio = gemini-3.8-flash
```

Provedor e modelo também podem ser trocados sem deploy em **Admin →
Configuração** (a config salva vence o env). A chave **não**: ela só existe no
`.env`, e o Admin mostra se está "configurada" ou "ausente". O `deploy.sh`
confere só o `LLM_PROVEDOR` do `.env` (recusa o deploy se faltar a chave
dele; não enxerga o que está salvo no Admin). Por isso o caminho recomendado
para o Gemini é o `.env` (`LLM_PROVEDOR=gemini` + `GEMINI_API_KEY`, depois
`scripts/deploy.sh`). Pelo Admin também funciona se o `.env` já tiver a chave
do provedor dele (ex.: OpenAI) **e** a `GEMINI_API_KEY`. Voltar para a OpenAI:
`LLM_PROVEDOR=openai` no `.env` (com `OPENAI_API_KEY`) ou `openai` no Admin.

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

**Gemini — chave e cobrança** (aistudio.google.com):

1. Em **Get API key** (https://aistudio.google.com/apikey), crie a chave num
   projeto do Google Cloud **com billing ativo** (é o projeto onde estão os
   créditos). Sem billing é o free tier: o Google pode usar o conteúdo para
   treinar e fazer revisão humana — não use com mensagens reais (LGPD).
2. Guarde a chave no `.env` da VPS (`GEMINI_API_KEY`) e uma cópia offline.
3. Acompanhe gasto e créditos no AI Studio (Usage/Billing) e o custo real nos
   logs (`[llm] ... provedor=gemini ... tokens_in= tokens_out= tokens_reasoning=`;
   `tokens_out` já inclui o raciocínio, que o Google cobra como saída).
4. **Saldo/quota acabou:** 402 (crédito pré-pago), billing desativado
   (`BILLING_DISABLED`) ou 429 `RESOURCE_EXHAUSTED` de quota **diária** → cada
   mensagem vai para `FALHA` com "sem crédito na API do Gemini" + ref, sem
   re-tentar, e dispara o alerta de ops (GAB-46). 429 de quota por minuto é
   rate limit: `FALHA` "HTTP 429", reprocessada depois pelo cron. Recarregue e
   as mensagens voltam pelo reprocessamento (GAB-41).

**LGPD — transferência internacional.** O texto das mensagens `#crm` vai para a
API do provedor de LLM, nos EUA (OpenAI; antes, igualmente, Anthropic). Só vai o
que chega à LLM: mensagens do grupo configurado marcadas com `#crm`, com o
contexto mínimo (nomes/ids de candidatos e fases). A chamada usa `store: false`
(a OpenAI não guarda a resposta para consulta) e nenhum log do CRM grava o texto
da mensagem nem o texto devolvido pela API. O aviso de privacidade da IJ deve
mencionar essa transferência ao provedor de LLM — decisão jurídica do usuário.
Com `LLM_PROVEDOR=gemini`, o destinatário é o **Google** (Gemini API, serviço
pago: sem uso para treino, log limitado contra abuso, processamento onde o
Google opera); o aviso deve citá-lo.

## 11. Recursos: limites, medição e instância mínima

Alvo: ≤ 15 usuários, numa instância pequena que também roda o site da IJ. Todo
serviço do `compose.prod.yml` tem `mem_limit`, e o processo dentro dele é
dimensionado para caber (heap do Node, buffers e conexões do Postgres,
`GOMEMLIMIT` do Caddy). Os valores são variáveis com padrão para uma
VPS de ~2 GB (lista comentada no `.env.prod.example`).

| Serviço | Limite | Ajustes |
|---|---|---|
| `app` | 512m | `--max-old-space-size=256`, pool Prisma 5 conexões |
| `db` | 256m | `shared_buffers=64MB`, `max_connections=15` (app 5 + migrate + backup + 3 reservadas), `work_mem=4MB`, `effective_cache_size=256MB`, sem workers paralelos |
| `evolution` | 512m | heap 256 MB, pool Prisma 5, integrações e telemetria desligadas, log `ERROR,WARN` |
| `evolution-db` | 192m | `shared_buffers=32MB`, `max_connections=20`, `work_mem=2MB` |
| `evolution-redis` | 96m | AOF, sem `maxmemory`: teto com `noeviction` recusaria escrita e com LRU apagaria chaves Signal da sessão; o `mem_limit` só segura vazamento |
| `caddy` | 128m | `GOMEMLIMIT=96MiB` |
| `migrate` (one-shot) | 512m | herda o ambiente do app |

Soma dos limites: ~1,7 GB (teto, não consumo). Consumo real abaixo.

### Medição (2026-10-26)

Medido com a 1ª versão dos limites (`max_connections=20`, Redis com `maxmemory
64mb`); nenhum dos dois chegou perto: `db` ≤ 35 MiB e Redis ≤ 8 MiB.

Stack de produção local (§8, projeto `ijcrm-medicao`), seed + 15 usuários e 300
oportunidades, sessão válida. Carga: 15 clientes em paralelo, 4 voltas por
`/login`, `/kanban`, `/tabela`, `/semana`, `/perfil` (300 requests pelo Caddy,
TLS). `docker stats --no-stream`; "pico" = maior amostra durante a carga. Máquina
de medição: notebook com 16 GB, então CPU/latência são só indicativas; memória é
o que importa.

| Serviço | Antes: ocioso | Antes: pico | Antes: 60 s depois | Depois: ocioso | Depois: pico | Depois: 60 s depois |
|---|---|---|---|---|---|---|
| `app` | 57 MiB | **1124 MiB** | 984 MiB | 57 MiB | **302 MiB** | 265 MiB |
| `db` | 29 MiB | 86 MiB | 84 MiB | 20 MiB | 35 MiB | 34 MiB |
| `evolution` | 488 MiB¹ | 488 MiB¹ | 184 MiB | 150 MiB | 149 MiB | 140 MiB |
| `evolution-db` | 30 MiB | 30 MiB | 28 MiB | 22 MiB | 23 MiB | 21 MiB |
| `evolution-redis` | 5 MiB | 5 MiB | 3 MiB | 8 MiB | 8 MiB | 8 MiB |
| `caddy` | 50 MiB | 32 MiB | 25 MiB | 40 MiB | 52 MiB | 49 MiB |
| **Total** | ~660 MiB | ~1,72 GiB | **~1,28 GiB** | ~300 MiB | ~570 MiB | **~520 MiB** |

¹ Boot da Evolution (`prisma migrate` + `prisma generate` + API) sem limite de
heap. Com o limite, o pico do boot medido foi 162 MiB, sem OOM.

- **App sem limite não devolve memória**: o V8 dimensiona o heap pela RAM do host
  e só coleta tarde. Mais 375 requests levaram o app a 1,3 GiB. Com o limite,
  mais 450 requests deixaram o app estável em ~295 MiB (sem OOM, sem restart).
  Com heap de 128 MB o RSS ficou igual (~295 MiB, quase todo fora do heap) e
  encostou num limite de 320m: por isso 256/512m.
- Latência na carga (15 paralelos): antes p50 0,36 s / p95 1,28 s; depois p50
  0,27 s / p95 1,13 s. Os limites não pioraram a resposta.
- Healthchecks de todos os serviços passaram com os limites; `OOMKilled=false`
  e 0 restarts em tudo.
- Não medido: Evolution com um número **pareado** (sessão real, metadados de
  grupo). Por isso o limite dela ficou em 512m, folgado.
- **Primeira semana em produção:** confira `docker stats --no-stream` da
  `evolution` e do `evolution-redis` (sessão pareada; chaves Signal e metadados
  de grupo crescem com o uso). Redis perto de 96m = suba `REDIS_MEM_LIMIT` antes
  de virar OOM-kill (o AOF recupera os dados, mas a Evolution perde a conexão).

Imagens (disco):

| Imagem | Tamanho |
|---|---|
| `ij-crm-app` (runtime) | 400 MB (~340 MB são a base `node:22-bookworm-slim`; o app em si ~48 MB) |
| `ij-crm-ops` (migrate/seed) | 1,97 GB (1,29 GB de `node_modules` completo; muda só quando o lockfile muda) |
| `evoapicloud/evolution-api:v2.3.7` | 1,81 GB |
| `postgres:16-alpine` (os dois bancos) | 420 MB |
| `caddy:2.10-alpine` | 85 MB |
| `redis:7-alpine` | 59 MB |

### Instância mínima recomendada

- **RAM: 2 GiB** (ex.: `t3.small`; `t4g.small` se as imagens forem buildadas para
  arm64, ver `IMAGE_PLATFORMS` no workflow) **+ 2 GiB de swap** em arquivo. A stack
  usa ~0,5 GiB em regime, o resto fica para o SO, o site e o page cache do Postgres.
  Se o site for pesado (Node/SSR com tráfego), vá de 4 GiB (`t3.medium`).
- **Disco: 20 GiB gp3** (mínimo; 30 GiB confortável): ~5 GB de imagens, até 5
  tags guardadas para rollback, 14 dias de backup e logs (rotação 10 MB × 5 por
  serviço).
- Não builde na VPS (`--build-local` só em emergência): `pnpm install` + `next build`
  pedem bem mais RAM que a stack rodando e deixam GBs de cache de build.

Swap (uma vez, na VPS):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Sinais de que um limite está curto: `docker stats` encostando no teto, ou
`docker inspect -f '{{.State.OOMKilled}} {{.RestartCount}}' <container>`
mostrando `true`/restarts. Suba a variável correspondente no `.env` e rode
`scripts/deploy.sh`.
