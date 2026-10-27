# Runbook de produção — ij-crm

Operação da VPS (GAB-30). Stack: `compose.prod.yml` com `caddy` (únicas portas
públicas: 80/443, só o app), `app`, `db` (Postgres 16), `evolution` +
`evolution-db` + `evolution-redis` (sem rota pública: porta só em `127.0.0.1`
da VPS) e o one-shot `migrate` (perfil `ops`). Repo em `/opt/ij-crm`.

## Checklist de go-live (AWS)

Do zero ao ar, em ordem. Cada passo aponta para a seção com os comandos
(`dc` = alias definido logo abaixo; tudo roda em `/opt/ij-crm`).

1. **Instância**: EC2 `t3.small` (x86_64, 2 GiB), Ubuntu 24.04 LTS, disco gp3 de
   20–30 GiB e **2 GiB de swap** em arquivo ([§11](#11-recursos-limites-medição-e-instância-mínima)).
   IP elástico. Security group: **só** 80 e 443 TCP de entrada (443 UDP opcional,
   HTTP/3). **Sem porta 22**: acesso de admin pelo Session Manager. **Não** abra
   8080 nem 3000. Instance profile `ij-crm-ec2-ssm` (`AmazonSSMManagedInstanceCore`)
   e agente SSM `Online` ([Deploy automático, "Configuração na AWS", passo 4](#deploy-automático-github-actions--aws-ssm)).
2. **Docker Engine + plugin compose v2** ([§0, "Docker na VPS"](#docker-na-vps)) e o
   **usuário `deploy`** no grupo `docker` ([Deploy automático, "Usuário `deploy`"](#deploy-automático-github-actions--aws-ssm)).
3. **Clonar em `/opt/ij-crm`** (dono: `deploy`) e criar `/var/backups/ij-crm` e
   `/var/log/ij-crm` ([§0](#0-primeira-instalação-vps-limpa)). Daqui em diante tudo
   roda como `deploy`: `sudo -iu deploy`.
4. **`.env`**: `cp .env.prod.example .env && chmod 600 .env`; `APP_DOMAIN`,
   `ACME_EMAIL`, um `openssl rand -hex 32` para cada segredo, `OPENAI_API_KEY`
   (conta com crédito pré-pago e auto-reload desligado, [§10](#10-provedor-de-llm-e-crédito-da-openai--gemini)).
   `NOTIFICATIONS_ENABLED=false` por enquanto. Cópia offline do `.env` no
   gerenciador de senhas da IJ (sem ela um backup não sobe numa VPS nova).
5. **DNS**: registro `A` (e `AAAA`, se usar IPv6) de `APP_DOMAIN` para o IP
   elástico, já propagado (`dig +short <domínio>`) **antes** do 1º deploy: o
   Caddy emite o certificado do Let's Encrypt na subida.
6. **Primeiro deploy** + seed: `scripts/deploy.sh --no-pull` e
   `dc --profile ops run --rm migrate prisma db seed` ([§0](#0-primeira-instalação-vps-limpa)).
   Conferir `dc ps` (tudo `healthy`) e `https://<domínio>/login` no navegador.
   **Smoke da LLM** (com a chave do provedor já no `.env`): rodar `pnpm llm:smoke`,
   na VPS `dc --profile ops run --rm llm-smoke` ([§10](#10-provedor-de-llm-e-crédito-da-openai--gemini)).
   Tem que terminar com `[llm-smoke] ok` (extração, classificação e resumo).
7. **Criar o admin** (`scripts/criar-admin.ts`, [§0](#0-primeira-instalação-vps-limpa)) e entrar no CRM.
8. **WhatsApp**: `scripts/evolution.sh criar` (uma vez) e parear o número dedicado
   em **Gestão → Admin → "Mostrar QR"** (ou `scripts/evolution.sh qr`, [§5](#5-ler-o-qr-da-evolution-criarreconectar-a-instância)).
   Estado "conectado" na mesma tela.
9. **Grupo**: com o número já no grupo de vendas, **Gestão → Admin → "Listar grupos"**,
   escolher e salvar. O valor do Admin vence o `GRUPO_JID` do `.env` (só fallback).
10. **Aviso de privacidade** da IJ publicado, mencionando o envio do texto das
    mensagens do grupo ao provedor de LLM nos EUA ([§10](#10-provedor-de-llm-e-crédito-da-openai--gemini), "LGPD").
    **Antes do webhook**: a partir dele, o classificador (com ou sem `#crm`) manda
    texto do grupo para a LLM mesmo com `NOTIFICATIONS_ENABLED=false` — o safe mode
    só cala o bot, não a LLM.
11. **Webhook da Evolution**: `scripts/evolution.sh webhook` ([§5](#5-ler-o-qr-da-evolution-criarreconectar-a-instância)).
    Teste: mensagem `#crm` no grupo → aparece em Gestão → Admin → Logs (bot ainda calado).
12. **Crontab**: `crontab deploy/crontab.example` e `crontab -l` ([§7](#7-cron-do-host)).
    Em até 10 min, `/var/log/ij-crm/cron.log` mostra `reprocessar HTTP 200`.
13. **Backup off-site testado**: rclone configurado, `BACKUP_REMOTE` no `.env`,
    `scripts/backup.sh` mostrando `off-site: rclone copy` e o arquivo listado no
    remote ([§3, "Backup off-site"](#backup-off-site-rclone)). Restore testado uma vez ([§3](#3-restaurar-backup)).
    **Não entrar em produção sem isso.**
14. **Deploy automático** ([Deploy automático](#deploy-automático-github-actions--aws-ssm)): provedor OIDC,
    role `ij-crm-deploy-gha` (trust de `deploy/iam/gha-trust.json`) com a policy, documento SSM
    `ij-crm-deploy` testado com `send-command`, environment `producao` (só `main`)
    com `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION` e `DEPLOY_INSTANCE_ID`, e um deploy de
    teste pelo Actions (re-run do último `imagens` da `main`). Proteção da `main`
    conferida. Daí em diante cada merge na `main` vai ao ar sozinho.
15. **Por último**: `NOTIFICATIONS_ENABLED=true` no `.env` e `scripts/deploy.sh`.
    Mandar um `#crm` de teste e conferir a confirmação no grupo.

Atalho usado em todo este documento (rode na raiz do repo):

```bash
alias dc='docker compose -f compose.prod.yml'
```

| Arquivo | Para quê |
|---|---|
| `scripts/deploy.sh` | deploy (`checa → git fetch + checkout do commit da tag → docker pull (por digest no automático) → backup → migrate → up → health`) e `rollback` por tag |
| `.github/workflows/imagens.yml` | CI: builda as imagens `app` e `ops` a cada push na `main`, publica no GHCR e faz o deploy automático na VPS |
| `scripts/deploy-remoto.sh` | entrada do deploy automático (documento SSM `deploy/ssm-deploy.yaml`): valida tag/digests e commit na `main`, roda `deploy.sh` destacado |
| `deploy/ssm-deploy.yaml`, `deploy/iam/` | documento SSM e policies IAM do deploy automático |
| `deploy/branch-protection-main.json` | proteção da `main` com o check obrigatório `deploy-e-migrations` |
| `scripts/checar-migrations.sh` | barra migration nova destrutiva sem `-- destrutiva-ok:` (CI) |
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

## 0. Primeira instalação (VPS limpa)

Pré-requisitos: Linux x86_64 com Docker Engine + plugin compose **recente**
(o deploy usa `docker compose config --environment` e `up --wait --wait-timeout`;
ensaiado com Docker 29.8 + Compose 5.6; um compose v2 antigo falha logo no
`config` do deploy, antes de mexer em algo), `git`, `curl`, `flock` (util-linux), `rclone` (off-site) e de
preferência `qrencode` e `jq`; usuário `deploy` no grupo `docker`, dono de
`/opt/ij-crm` ([Deploy automático, "Usuário `deploy`"](#deploy-automático-github-actions--aws-ssm)). Acesso pelo
Session Manager, sem SSH.
Instância mínima e swap: §11.

### Docker na VPS

Ubuntu 24.04 (recomendado), pelo repositório apt oficial da Docker (o
`docker.io` da distro pode vir sem o plugin compose ou com versão antiga):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"      # depois saia e entre de novo na sessão
sudo apt-get install -y git util-linux qrencode jq rclone
docker compose version
```

O `rclone` da distro basta para o `backup.sh` (`copy` e `delete --min-age`). Se o
provedor do off-site exigir versão mais nova: baixe o `.zip` em
<https://rclone.org/downloads/> junto com o `SHA256SUMS`, confira
(`sha256sum -c --ignore-missing SHA256SUMS`) e só então instale o binário em
`/usr/local/bin/rclone`.

Amazon Linux 2023: `dnf install docker` **não** traz o plugin compose; instale o
binário `docker-compose-linux-x86_64` do GitHub em `/usr/local/lib/docker/cli-plugins/docker-compose`.

### Imagens e primeira subida

As imagens vêm prontas do GHCR (`ghcr.io/gabriel-marques-tech/ij-crm-app` e
`…-ops`, buildadas pelo CI, só `linux/amd64`): a VPS **não builda**. Os pacotes
são **públicos**: `docker pull` funciona sem login. Se algum dia virarem
privados, faça login uma vez com um PAT clássico só de leitura (GitHub: Settings
→ Developer settings → Personal access tokens → Tokens (classic) → escopo
**apenas** `read:packages`):

```bash
read -rs -p "PAT read:packages: " GHCR_PAT && echo
printf '%s' "$GHCR_PAT" | docker login ghcr.io -u <usuario-github> --password-stdin
unset GHCR_PAT    # credencial fica em ~/.docker/config.json (chmod 600)
```

O repo também é público: o `git clone`/`git fetch` da VPS usa HTTPS sem chave.

```bash
sudo git clone https://github.com/Gabriel-Marques-tech/ij-crm.git /opt/ij-crm && sudo chown -R deploy:deploy /opt/ij-crm
sudo mkdir -p /var/backups/ij-crm /var/log/ij-crm && sudo chown deploy:deploy /var/backups/ij-crm /var/log/ij-crm
sudo -iu deploy                                   # daqui em diante, como deploy
cd /opt/ij-crm
cp .env.prod.example .env && chmod 600 .env
# preencher: APP_DOMAIN, ACME_EMAIL, OPENAI_API_KEY e um `openssl rand -hex 32` para cada segredo:
for v in POSTGRES_PASSWORD EVOLUTION_DB_PASSWORD EVOLUTION_REDIS_PASSWORD EVOLUTION_API_KEY \
  EVOLUTION_WEBHOOK_SECRET CRON_SECRET; do sed -i "s|^$v=$|$v=$(openssl rand -hex 32)|" .env; done
scripts/deploy.sh --no-pull                       # 1º deploy: baixa :latest do GHCR (banco vazio: sem backup)
dc --profile ops run --rm migrate prisma db seed  # pipelines/fases do Pipefy (só na 1ª vez)

# Primeiro admin — a senha nunca vai na linha de comando (fica fora do `ps` e do histórico):
read -rs -p "Senha do admin (min 8): " ADMIN_SENHA && echo && export ADMIN_SENHA
dc --profile ops run --rm -e ADMIN_NOME="Nome" -e ADMIN_EMAIL=voce@ij.com -e ADMIN_SENHA \
  migrate tsx scripts/criar-admin.ts
unset ADMIN_SENHA

crontab deploy/crontab.example   # substitui o crontab do usuário; confira com crontab -l
```

Depois: parear o WhatsApp (§5) e seguir o checklist de go-live do topo.

Ensaio deste §0 (2026-10-27, clone limpo, imagens do GHCR, sem build): o 1º
deploy levou ~85 s (≈ 40 s baixando a `ops` de 2 GB), `latest` virou
`sha-<commit>`, todos os serviços `healthy` dentro dos `mem_limit` (app 74 MiB,
evolution 206 MiB ociosos). Deploys seguintes da mesma tag: ~10 s.

> `docker compose -f compose.prod.yml up -d` sozinho também sobe a stack (e
> reinícios usam `restart: unless-stopped`), mas **não** roda migrations: elas
> são passo explícito do `deploy.sh`, nunca no boot do app.

## 1. Deploy

Fluxo: merge na `main` → o workflow **imagens** (GitHub Actions) builda e publica
`ij-crm-app` e `ij-crm-ops` com as tags `sha-<commit curto>` e `latest` (≈ 5–10
min; acompanhe na aba Actions) → o job `deploy` do mesmo workflow roda
`scripts/deploy.sh sha-<commit>` (conferindo os digests) na VPS por AWS SSM
([Deploy automático](#deploy-automático-github-actions--aws-ssm)).
Deploy à mão (tag específica, workflow pausado, emergência), como `deploy`
(`sudo -iu deploy`):

```bash
cd /opt/ij-crm && scripts/deploy.sh                 # a imagem :latest (resolvida para o sha-… dela)
scripts/deploy.sh sha-1a2b3c4                       # uma tag específica (ver Actions ou o GHCR)
scripts/deploy.sh --build-local                     # escape: sem CI/registry, builda NESTA máquina
```

Voltar para um commit **anterior a este deploy por checkout** (PR #35): use
`scripts/deploy.sh rollback sha-…` (troca só o app, sem checkout). Um `deploy.sh
sha-<antigo>` deixaria no disco o `deploy.sh` antigo, que faz `git pull` e falha
em HEAD destacado; para sair disso: `git checkout -q --detach origin/main`.

`--build-local` gera `local-<commit>` com `docker compose build` na própria VPS:
precisa de ~2 GB de RAM livres e alguns GB de disco de cache. Numa instância de
2 GB, pare o app ou use swap. Só para emergência (GitHub fora, CI quebrado).

O script, na ordem:

1. recusa se `git status --porcelain` mostrar qualquer coisa (mudança ou arquivo
   não rastreado). `--force` aceita;
2. `git fetch` e `git checkout --detach <commit da tag>`: `compose.prod.yml`,
   `Caddyfile` e scripts são **os do mesmo commit da imagem**, não os do HEAD da
   `main` (se a `main` andou durante o deploy, os arquivos não se adiantam à
   imagem). `latest` é resolvida antes para o `sha-…` dela; `--build-local` usa
   `origin/main`. O commit é achado **só na história de `origin/main`, pelo prefixo
do sha** (nunca por nome de branch/tag); fora da `main` ou ambíguo: recusa. Re-executa o próprio
   script desse commit. O repo fica em HEAD destacado (normal; não faça `git pull`
   à mão, use o `deploy.sh`);
3. confere o ambiente **como o compose resolve** (`docker compose config
   --environment`: `.env` + variáveis do shell): segredos com ≥ 32 caracteres e
   sem `troque-me`, senhas de banco/Redis seguras para URL, domínio e email
   preenchidos, e a chave do provedor de LLM selecionado (§10). Erro aborta antes de mexer em algo. Avisa se `NOTIFICATIONS_ENABLED` ≠ `true`;
4. `docker pull` das imagens `app` e `ops` da tag. `latest` é resolvida para a
   tag imutável `sha-<commit>` (label `org.opencontainers.image.revision` que o CI
   grava), então histórico e rollback nunca dependem de `latest`. Falha no pull
   (tag não existe, sem `docker login`) aborta antes de mexer em algo. Com
   `--digest-app=sha256:… --digest-ops=sha256:…` (o deploy automático sempre
   passa): baixa `<imagem>@<digest>` em vez da tag (tags do GHCR são mutáveis) e
   recusa, antes de mexer em algo, se a imagem local `:<tag>` tiver outro digest
   ou se o label de revisão não for do commit da tag;
5. **backup sempre que o banco já tem dados** (existe `_prisma_migrations`);
6. `prisma migrate deploy` no container one-shot `migrate`. Se falhar, para aqui:
   o app antigo segue no ar e o script mostra o dump do passo 5 (§2, "Migration falhou");
7. `up -d --wait` com a imagem nova (espera todos os healthchecks) e
   `GET https://APP_DOMAIN/api/health` pelo Caddy (TLS de verdade) = 200, em até
   `HEALTH_TENTATIVAS` tentativas (padrão 20) com timeout de `HEALTH_TIMEOUT` s
   (padrão 3) e 3 s entre elas, ~1–2 min no pior caso (no 1º deploy o certificado
   ainda está sendo emitido). Como `IMAGENS_MANTER`, são lidas **do ambiente do
   shell, não do `.env`**: `HEALTH_TENTATIVAS=40 scripts/deploy.sh`. Valor
   inválido é recusado antes de mexer em algo;
8. sucesso: registra a tag em `.deploy/historico` e em `.deploy/atual`, marca `:latest` local e apaga
   as imagens `app`/`ops` fora das últimas `IMAGENS_MANTER` (padrão 5) tags do
   histórico, mais as camadas órfãs.
   **Falha no passo 7: rollback automático** do app para a tag de
   `.deploy/atual` (o último deploy **ou rollback** bom: depois de um rollback
   manual, volta para onde o operador deixou, não para a versão abandonada) e
   saída com código 10 (rollback ok) ou 11 (o app não voltou; intervenção manual) — o schema não volta; ver §2. Falha antes de trocar o app sai com 1.

Um deploy/rollback por vez: o script segura `flock` em `.deploy/lock`; o
segundo **espera** até `LOCK_ESPERA` s (padrão 900, do ambiente do shell) e só
então sai com "outro deploy/rollback em andamento há mais de …". O comportamento do
script (incluindo o rollback automático) tem teste sem Docker:
`bash scripts/teste-deploy.sh`.

Comandos úteis: `dc ps` (estado + health), `dc logs -f app`,
`cat .deploy/historico` (deploys bons em ordem), `cat .deploy/atual` (a tag boa que deve estar rodando).

Depois de um rollback automático confira `dc ps`: ele só troca o `app`. Se o
que falhou foi outro serviço (ex.: a Evolution não subiu), ele segue com o
problema. Veja `dc logs <serviço>`.

## Deploy automático (GitHub Actions + AWS SSM)

Cada push na `main` (merge de PR) roda o workflow **imagens**:

1. job `build`: publica `ij-crm-app`/`ij-crm-ops` com `sha-<commit curto>` e
   `latest` e exporta os **digests** das duas imagens;
2. job `deploy` (environment `producao`): troca o token OIDC do GitHub por uma
   credencial **temporária** da role `ij-crm-deploy-gha` (nenhuma chave guardada
   no GitHub) e manda, por **SSM Run Command**, o documento `ij-crm-deploy`
   (`deploy/ssm-deploy.yaml`) com `tag` + `digestApp` + `digestOps`;
3. na VPS, o agente SSM roda como root só
   `runuser -u deploy -- env -i PATH=… HOME=/home/deploy LC_ALL=C /opt/ij-crm/scripts/deploy-remoto.sh <tag> <digests>`
   (ambiente limpo: nada do agente chega ao deploy; o próprio script se
   re-executa com `env -i` se herdar qualquer outra variável ou função), que
   valida tudo de novo, faz `git fetch` e acha o commit **só na história de
   `origin/main`, pelo prefixo do sha** (um branch ou tag com nome de hash não o
   substitui; fora da `main` = recusa), e roda `scripts/deploy.sh <tag>
   --digest-app=… --digest-ops=…` destacado (`setsid`), com log em
   `/var/log/ij-crm/deploy-<UTC>-<tag>.log`;
4. o `deploy.sh` faz checkout do commit da tag (compose/Caddyfile/scripts batem
   com a imagem), baixa as imagens **por digest** e recusa se o digest ou o
   commit gravado na imagem não baterem; depois segue o fluxo normal do §1.

**Porta 22 fechada**: o security group só tem entrada 80/443. Admin entra por
**Session Manager** (passo 7). A role do GitHub só pode `ssm:SendCommand` com
esse documento nessa instância: credencial vazada ou workflow alterado em outra
branch não roda comando arbitrário, não faz deploy de imagem de branch (tag
`branch-…`, recusada pelo padrão; digest de branch, recusado pelo commit da
imagem) nem de commit fora da `main`.

- **Resultado**: o código de saída do `deploy.sh` define o do job, e o Actions
  classifica pelo **código** (`ResponseCode` do SSM), não pelo texto da saída
  (que o SSM trunca em ~24 mil caracteres):

  | Código | Significado |
  |---|---|
  | 0 | ok |
  | 1 | falhou **antes** de trocar o app (checagens, pull/digest, backup, migration): a versão anterior segue no ar |
  | 2 | recusado pelo `deploy-remoto.sh` (tag, digest, commit fora da `main`): nada rodou |
  | 10 | up/health falhou e o rollback automático voltou o app para a versão anterior |
  | 11 | up/health falhou e o app **não** voltou (rollback falhou, sem anterior ou mesma tag): intervenção manual (§2) |

  Qualquer código ≠ 0 = ❌ no Actions + email para quem fez o push. A saída do
  SSM traz uma linha `deploy-remoto: RESULTADO=<código> <descrição>` logo depois
  do fim do deploy (antes do trecho do log), repetida no resumo do job junto com
  tag, commit, digests e id do comando SSM. Também: não entregue, timeout, cancelado. Se não dá para saber (API do SSM fora,
  prazo do job), o resumo diz **"status desconhecido — verifique o status no
  SSM"** e não afirma que falhou: `aws ssm get-command-invocation --command-id <id>
  --instance-id <i-…>` ou Systems Manager → Run Command → Command history.
- **Destacado do SSM**: timeout (45 min no documento), cancelamento ou queda do
  canal não matam o `deploy.sh` no meio de uma migration; ele vai até o fim e
  grava o código no log. Por isso, depois de "TimedOut"/"Cancelled", olhe o log na VPS.
- **Ordem**: um deploy por vez (`concurrency: deploy-producao`, sem cancelar o
  que está rodando), e o workflow inteiro já é serializado na `main`. Com vários
  merges seguidos, o GitHub mantém **um** pendente: o intermediário é cancelado
  e vai ao ar o mais novo (ele contém o anterior). Deploy manual rodando: o
  automático **espera** o lock até 15 min (`flock -w 900`).
- **Sem configuração** (antes de existir a VPS): o job passa verde com o aviso
  "Deploy pulado" e um *warning* "Deploy automático NÃO rodou" (para uma variável
  apagada por engano não passar despercebida). Configuração pela metade ou
  inválida: o job falha dizendo o quê.
- **Escopo**: só `push` na `main`; PRs, outras branches e `workflow_dispatch`
  não fazem deploy. Permissão do job: só `id-token: write` (sem checkout).

### Proteção da `main`

Já ligada (Settings → Branches → `main`): **só por PR** (0 aprovações
obrigatórias), vale também para admins (`enforce_admins`), sem force-push e sem
apagar a branch. É ela que dá sentido ao "ancestral de `origin/main`": código na
`main` passou por PR. Conferir:

```bash
gh api repos/Gabriel-Marques-tech/ij-crm/branches/main/protection \
  --jq '{pr: .required_pull_request_reviews.required_approving_review_count, admins: .enforce_admins.enabled, force_push: .allow_force_pushes.enabled, delete: .allow_deletions.enabled}'
```

O check **`deploy-e-migrations`** (workflow `verificacoes`) é **OBRIGATÓRIO** na
`main`: ele barra migration destrutiva sem marcador e roda os testes dos scripts
de deploy. Ele entra na proteção **logo depois do merge do PR #35** (antes disso
travaria todo PR aberto que ainda não tem o workflow). Comando (PUT da proteção
inteira: repete as regras atuais e acrescenta o check; `app_id` 15368 = GitHub
Actions), em `deploy/branch-protection-main.json`:

```bash
gh api -X PUT repos/Gabriel-Marques-tech/ij-crm/branches/main/protection \
  --input deploy/branch-protection-main.json
gh api repos/Gabriel-Marques-tech/ij-crm/branches/main/protection \
  --jq '.required_status_checks.checks'      # → [{"context":"deploy-e-migrations","app_id":15368}]
```

### Usuário `deploy` e o risco aceito

Usuário dedicado, sem senha nem chave SSH, no grupo `docker`, dono de
`/opt/ij-crm` (repo, `.env`, `.deploy/`), `/var/backups/ij-crm`,
`/var/log/ij-crm`, do crontab e do `~/.config/rclone`. Admin opera como ele via
`sudo -iu deploy` numa sessão do Session Manager.

**Risco aceito: `scripts/` é gravável pelo `deploy`.** O deploy faz `git
checkout` do commit da tag, que reescreve `scripts/`, `compose.prod.yml` e
`Caddyfile`; com `scripts/` de root e só leitura, o checkout quebra. Na prática
não muda nada: o `deploy` está no grupo `docker`, que já equivale a root no host,
e ninguém de fora chega a um shell dele (sem SSH; o SSM só roda o documento
fixo, que só chama `deploy-remoto.sh` com parâmetros validados).

```bash
sudo useradd -m -s /bin/bash -c "deploy ij-crm" -G docker deploy
sudo passwd -l deploy           # sem senha; entra-se só por sudo -iu deploy
```

Só se a VPS já foi instalada (§0) com outro usuário: passar tudo para o `deploy`.

```bash
sudo chown -R deploy:deploy /opt/ij-crm /var/backups/ij-crm /var/log/ij-crm
crontab -l > /tmp/crontab.ij && sudo crontab -u deploy /tmp/crontab.ij && crontab -r && rm /tmp/crontab.ij
# rclone: copie ~/.config/rclone/rclone.conf para /home/deploy/.config/rclone/ (chmod 600, dono deploy)
```

### Configuração na AWS (uma vez)

Rode da sua máquina, com a AWS CLI logada como admin da conta, na raiz do repo.
Os JSON ficam em `deploy/iam/`; troque `<ACCOUNT_ID>`, `<REGION>` e
`<INSTANCE_ID>` antes de usar (`sed` abaixo).

```bash
export AWS_REGION=sa-east-1                     # região da VPS
CONTA=$(aws sts get-caller-identity --query Account --output text)
INST=i-0123456789abcdef0                        # EC2 → Instances
```

**1. Provedor OIDC do GitHub** (uma vez por conta; a AWS não confere mais o thumbprint):

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com
```

**2. Role `ij-crm-deploy-gha`**, que só o job `deploy` do `imagens.yml` da
`main`, no environment `producao`, deste repositório, consegue assumir. A
trust (`deploy/iam/gha-trust.json`) exige, com `StringEquals`:

- `aud` = `sts.amazonaws.com`;
- `sub` = `repo:Gabriel-Marques-tech@257883742/ij-crm@1432391516:environment:producao`:
  formato **padrão** do repo, que usa o *immutable subject* do GitHub (nome +
  id numérico do dono e do repo). Nada de customização de `sub` no repo;
- `repository_id` = `1432391516` e `repository_owner_id` = `257883742`
  (ids imutáveis: renomear ou recriar o repo/conta não reaproveita a role);
- `environment` = `producao`, `ref` = `refs/heads/main`;
- `job_workflow_ref` = `Gabriel-Marques-tech/ij-crm/.github/workflows/imagens.yml@refs/heads/main`.

A AWS aceita esses claims do GitHub direto como chaves de condição
(`token.actions.githubusercontent.com:job_workflow_ref`, `:repository_id`,
`:repository_owner_id`, `:environment`, `:ref`…): IAM User Guide, "IAM and AWS
STS condition context keys" → "Available keys for AWS OIDC federation", aba
GitHub (<https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html#condition-keys-wif>).
Confira o prefixo do `sub` antes de criar a role (se `use_default` vier `false`,
alguém customizou: volte com `-F use_default=true`):

```bash
gh api repos/Gabriel-Marques-tech/ij-crm/actions/oidc/customization/sub
# {"use_default":true,"use_immutable_subject":true,"sub_claim_prefix":"repo:Gabriel-Marques-tech@257883742/ij-crm@1432391516"}
sed "s/<ACCOUNT_ID>/$CONTA/" deploy/iam/gha-trust.json > /tmp/gha-trust.json
aws iam create-role --role-name ij-crm-deploy-gha --max-session-duration 3600 \
  --assume-role-policy-document file:///tmp/gha-trust.json
```

Se o 1º deploy falhar em "Credenciais da AWS" com `Not authorized to perform
sts:AssumeRoleWithWebIdentity`, um claim não bateu. O mais provável é o
`job_workflow_ref`: a documentação do GitHub o descreve para workflows
reutilizáveis, e o formato `:environment:` do `sub` imutável foi deduzido do
`sub_claim_prefix` acima. Tire uma condição por vez da trust (`aws iam
update-assume-role-policy`), começando pelo `job_workflow_ref`, até achar qual;
`sub` + `repository_id` + `environment` + `ref` já restringem ao essencial.

**3. Permissões da role**: `ssm:SendCommand` só no documento e na instância;
`ssm:GetCommandInvocation` para acompanhar (essa ação não aceita restrição por
recurso, daí o `*`). Nada mais.

```bash
sed -e "s/<ACCOUNT_ID>/$CONTA/g" -e "s/<REGION>/$AWS_REGION/g" -e "s/<INSTANCE_ID>/$INST/g" \
  deploy/iam/gha-deploy-policy.json > /tmp/gha-deploy-policy.json
aws iam put-role-policy --role-name ij-crm-deploy-gha --policy-name ij-crm-deploy-ssm \
  --policy-document file:///tmp/gha-deploy-policy.json
```

**4. Instance profile da VPS com `AmazonSSMManagedInstanceCore`** (o agente SSM
se registra; sem ele não há Session Manager nem Run Command):

```bash
aws iam create-role --role-name ij-crm-ec2-ssm --assume-role-policy-document file://deploy/iam/ec2-trust.json
aws iam attach-role-policy --role-name ij-crm-ec2-ssm \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name ij-crm-ec2-ssm
aws iam add-role-to-instance-profile --instance-profile-name ij-crm-ec2-ssm --role-name ij-crm-ec2-ssm
aws ec2 associate-iam-instance-profile --instance-id "$INST" --iam-instance-profile Name=ij-crm-ec2-ssm
```

O agente vem instalado como **snap** na AMI do Ubuntu 24.04. Conferir o registro:

```bash
aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INST" \
  --query 'InstanceInformationList[].{ping:PingStatus,agente:AgentVersion,so:PlatformName}'
# ping "Online". Se não aparecer em ~5 min: na VPS, sudo snap list amazon-ssm-agent
# e sudo snap restart amazon-ssm-agent (sem o snap: sudo snap install amazon-ssm-agent --classic)
```

**5. Documento `ij-crm-deploy`** a partir do arquivo do repo:

```bash
aws ssm create-document --name ij-crm-deploy --document-type Command \
  --document-format YAML --content file://deploy/ssm-deploy.yaml
# Quando deploy/ssm-deploy.yaml mudar:
aws ssm update-document --name ij-crm-deploy --document-version '$LATEST' \
  --document-format YAML --content file://deploy/ssm-deploy.yaml
aws ssm update-document-default-version --name ij-crm-deploy --document-version <versão nova>
```

Teste antes de ligar o Actions (tag/digests atuais: resumo do último run do
**imagens**; a tag tem de ser da `main`):

```bash
aws ssm send-command --document-name ij-crm-deploy --instance-ids "$INST" \
  --parameters '{"tag":["sha-1a2b3c4"],"digestApp":["sha256:…"],"digestOps":["sha256:…"]}' \
  --query Command.CommandId --output text
aws ssm get-command-invocation --command-id <id> --instance-id "$INST" \
  --query '{status:Status,codigo:ResponseCode,saida:StandardOutputContent}'
# "latest" ou qualquer coisa fora do padrão: o próprio SSM recusa (allowedPattern).
```

**6. Security group**: remova a regra de entrada da porta 22. Só 80/443 TCP (e
443 UDP, se usar HTTP/3). Session Manager e Run Command saem da VPS para a AWS
(HTTPS de saída), não precisam de porta aberta.

### Configuração no GitHub

Environment `producao` (Settings → Environments): **sem** "Required reviewers";
**Deployment branches and tags** → *Selected branches and tags* → `main`; e as
**variáveis** (não são segredos):

| Variável (environment `producao`) | Valor |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<conta>:role/ij-crm-deploy-gha` |
| `AWS_REGION` | região da VPS (ex.: `sa-east-1`) |
| `DEPLOY_INSTANCE_ID` | `i-…` da VPS |

```bash
gh api -X PUT repos/Gabriel-Marques-tech/ij-crm/environments/producao \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/Gabriel-Marques-tech/ij-crm/environments/producao/deployment-branch-policies -f name=main
gh variable set AWS_DEPLOY_ROLE_ARN --env producao --body "arn:aws:iam::$CONTA:role/ij-crm-deploy-gha"
gh variable set AWS_REGION --env producao --body "$AWS_REGION"
gh variable set DEPLOY_INSTANCE_ID --env producao --body "$INST"
```

Primeiro deploy pelo Actions: **imagens** → último run da `main` → *Re-run all
jobs*. O job `deploy` deve terminar ✅ com "ok" no resumo. Histórico: aba
**Environments → producao**; na VPS, `journalctl -t ij-crm-deploy` e
`ls -t /var/log/ij-crm/deploy-*.log`.

### Acesso de admin: Session Manager

Sem SSH. Precisa da AWS CLI com o [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
(ou o console: EC2 → a instância → **Connect → Session Manager**):

```bash
aws ssm start-session --target i-0123456789abcdef0     # entra como ssm-user (com sudo)
sudo -iu deploy
cd /opt/ij-crm
# túnel para o manager da Evolution (§5), da sua máquina:
aws ssm start-session --target i-0123456789abcdef0 --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8080"],"localPortNumber":["8080"]}'
```

### Deploy de uma tag específica e rollback (à mão)

Igual a antes, numa sessão do Session Manager, como `deploy`:

```bash
sudo -iu deploy
cd /opt/ij-crm
scripts/deploy.sh sha-1a2b3c4       # §1 (pega os arquivos do commit dessa tag)
scripts/deploy.sh rollback          # §2 (ou: rollback sha-1a2b3c4)
```

Deploy à mão e automático disputam o mesmo `flock`: o segundo espera até 15 min
(`LOCK_ESPERA`) e só então desiste. **Depois de um rollback, pause o deploy
automático** até corrigir: o próximo merge na `main` sobe a versão nova por cima.

### Pausar o deploy automático

Variável de **repositório** `DEPLOY_AUTOMATICO=false` (Settings → Secrets and
variables → Actions → Variables): o build continua publicando imagens e o job
`deploy` aparece como *skipped* (o resumo do build avisa "pausado").

```bash
gh variable set DEPLOY_AUTOMATICO --body false     # pausar
gh variable delete DEPLOY_AUTOMATICO               # voltar (ou --body true)
```

Corte de emergência do lado da AWS: `aws iam delete-role-policy --role-name
ij-crm-deploy-gha --policy-name ij-crm-deploy-ssm` (o job passa a falhar no
`send-command`; recoloque com o passo 3).

Testes sem AWS nem Docker: `bash scripts/teste-deploy-remoto.sh` (entrada na
VPS), `bash scripts/teste-workflow-deploy.sh` (passos do job com um `aws` falso),
`bash scripts/teste-deploy.sh` e `bash scripts/teste-checar-migrations.sh`.

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

**O schema do banco não volta.** Por isso a regra **expand/contract**: toda
migration tem de funcionar com a versão **anterior** do app (a que segue no ar
durante o deploy e é o alvo do rollback). Adicionar tabela/coluna (nullable ou
com default) e índice: livre. Remover, renomear ou trocar tipo: **duas
releases** — na 1ª o código para de usar (ou passa a escrever nos dois lugares),
na 2ª a migration remove, com a linha `-- destrutiva-ok: <motivo>`. O CI
(`scripts/checar-migrations.sh`, no PR e no build da `main`) recusa migration
nova com `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN … TYPE` ou `RENAME` sem esse
marcador. Se mesmo assim a migration do deploy quebrou o código antigo,
restaure o dump que o próprio deploy fez antes de migrar (§3) e então rode o
rollback.

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

### Backup off-site (rclone)

Uma vez, **como o mesmo usuário do crontab e do deploy** (o rclone lê
`~/.config/rclone/rclone.conf` desse usuário):

```bash
rclone config            # n → nome (ex.: b2) → tipo do provedor (B2, S3, R2, Drive…) → credenciais
rclone mkdir b2:ij-crm-backups && rclone lsd b2:   # o bucket existe e a credencial funciona
# no .env:  BACKUP_REMOTE=b2:ij-crm-backups
scripts/backup.sh        # deve logar "off-site: rclone copy → b2:ij-crm-backups"
rclone ls b2:ij-crm-backups                        # o dump recém-criado aparece
```

A credencial precisa de leitura, escrita **e apagar** no bucket (a retenção de 14
dias roda `rclone delete --min-age 14d`). Prefira um bucket só para isso, em
outra conta/região que não a da VPS. Sem `BACKUP_REMOTE`, `backup.sh` só avisa
no log; com `BACKUP_REMOTE` e sem `rclone` instalado, falha.

**O banco e o Redis da Evolution não entram no backup** (decisão do GAB-30).
Eles guardam a sessão do WhatsApp (credenciais e chaves Signal do Baileys) e
config da instância, nada do CRM. Num desastre (VPS nova, volumes perdidos), o
caminho é parear de novo: §5 inteiro (criar instância → QR → webhook → conferir
o grupo em Gestão → Admin). Restaurar só o banco do CRM numa VPS que ainda tem os volumes da
Evolution não mexe no WhatsApp.

Teste de restore (rodar a cada poucos meses; foi executado no GAB-30): restaurar
o dump mais recente, conferir contagens (`dc exec db psql -U ijcrm -d ijcrm -c
'select count(*) from oportunidade'`) e abrir o Kanban.

## 4. Trocar o número do bot

O número é só a sessão do WhatsApp na instância da Evolution. O CRM guarda o
JID do **grupo** (salvo em Gestão → Admin; `GRUPO_JID` do `.env` é só fallback),
não o número do bot.

```bash
scripts/evolution.sh logout   # desconecta o número antigo
scripts/evolution.sh qr       # parear com o celular do número NOVO (§5)
scripts/evolution.sh estado   # "open" = conectado
# no WhatsApp: adicionar o número novo ao grupo de vendas (e remover o antigo)
```

Depois, em **Gestão → Admin**, confira o grupo: "Listar grupos" deve mostrar o
mesmo grupo salvo. O webhook é da instância e continua configurado. Se o grupo
mudou (grupo novo), escolha-o em **Gestão → Admin → "Listar grupos"** e salve:
vale na hora, sem deploy. `GRUPO_JID` no `.env` é só o fallback de quando o Admin
não tem grupo salvo — o valor do Admin vence, então mudar só o `.env` não troca
o grupo. Teste mandando uma mensagem `#crm` no grupo e conferindo a confirmação.

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
scripts/evolution.sh grupos    # lista JID + nome dos grupos (só consulta)
```

Pelo CRM (depois do `criar`): **Gestão → Admin** mostra o estado da Evolution e o
botão "Mostrar QR" (só ADMIN). **O grupo se escolhe lá**: "Listar grupos" grava o
grupo na configuração técnica e vale na hora, sem deploy (README "Admin:
configuração técnica e logs"). `GRUPO_JID` no `.env` é só fallback para quando o
Admin não tem grupo salvo; o valor do Admin vence. O webhook continua sendo pelo
`scripts/evolution.sh webhook`.

Sem `qrencode`, o `qr` grava o PNG num diretório `~/.ij-crm.XXXX` com permissão
só do dono e **apaga ao apertar Enter**. Sem SSH não há `scp`: instale o
`qrencode` (QR no terminal) ou use a tela do Admin.

Alternativa visual (manager web da Evolution), por túnel do Session Manager a partir da sua máquina:

```bash
aws ssm start-session --target <i-…> --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8080"],"localPortNumber":["8080"]}'     # deixe aberto
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

**Smoke depois de configurar a chave** (obrigatório antes de ligar o grupo, e
depois de trocar provedor/modelo): `pnpm llm:smoke` (`scripts/smoke-llm.ts`).
Faz UMA chamada real por schema (extração, classificação e resumo) com uma
mensagem sintética, sem dado pessoal, e imprime só status, tokens e ms; sai ≠ 0
se algo falhar. A imagem do `app` não tem `tsx` nem o código-fonte, então em
produção ele roda na imagem `ops`, com o mesmo env do app e só a rede `edge`
(saída para a API):

```bash
dc --profile ops run --rm llm-smoke
# testar o Gemini antes de trocar o .env:  dc --profile ops run --rm -e LLM_PROVEDOR=gemini llm-smoke
```

Lê só o `.env` (não a config salva no Admin). Saída esperada: três linhas
`[llm-smoke] <operacao> ok provedor=... modelo=... ms=... tokens_in=...` e
`[llm-smoke] ok`. `FALHA codigo=HTTP status=400` costuma ser chave/modelo/schema;
`SEM_CREDITO`/`COTA_DIARIA`, ver abaixo.

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
   créditos). Sem billing é o free tier ("Unpaid Services"): pelos termos
   (https://ai.google.dev/gemini-api/terms), o Google usa prompts e respostas
   para melhorar produtos e modelos, e revisores humanos podem ler e anotar o
   conteúdo — não use com mensagens reais (LGPD).
2. Guarde a chave no `.env` da VPS (`GEMINI_API_KEY`) e uma cópia offline.
   Rode o smoke (`dc --profile ops run --rm llm-smoke`, acima).
3. Acompanhe gasto e créditos no AI Studio (Usage/Billing) e o custo real nos
   logs (`[llm] ... provedor=gemini ... tokens_in= tokens_out= tokens_reasoning=`;
   `tokens_out` já inclui o raciocínio, que o Google cobra como saída).
4. **Saldo acabou:** HTTP 402 — crédito pré-pago esgotado, documentado em
   https://ai.google.dev/gemini-api/docs/api-errors (`payment_required`) e
   https://ai.google.dev/gemini-api/docs/troubleshooting — ou billing desativado
   (`ErrorInfo.reason` `BILLING_DISABLED`) → cada mensagem vai para `FALHA` com
   "sem crédito na API do Gemini" + ref, sem re-tentar, e dispara o alerta de ops
   (GAB-46). Recarregue e as mensagens voltam pelo reprocessamento (GAB-41).
5. **Cota diária acabou:** 429 `RESOURCE_EXHAUSTED` com `QuotaFailure` de
   `quotaId` diário (`...PerDay...`) → `FALHA` com "cota diária do Gemini
   esgotada; volta no próximo dia ou aumente o limite no AI Studio" + ref, sem
   re-tentar. Também dispara o alerta de ops (texto próprio, mesmo cooldown de
   6 h e mesmo banner do sem crédito). Não é saldo: no dia seguinte a cota
   volta e o cron reprocessa (como no sem crédito, essas `FALHA` voltam sempre
   e a execução para na primeira que ainda falhar). Para não esperar: aumente
   o limite/tier em AI Studio → Usage/Rate limits.
6. 429 de quota **por minuto** é rate limit: `FALHA` "HTTP 429", reprocessada
   depois pelo cron (até 3 tentativas).

**LGPD — transferência internacional.** O texto das mensagens do grupo vai para a
API do provedor de LLM, nos EUA (OpenAI; antes, igualmente, Anthropic). Só vai o
que chega à LLM: mensagens do grupo configurado — as marcadas com `#crm` e, desde
o GAB-39, também as sem `#crm` que passam pelo classificador —, com o
contexto mínimo (nomes/ids de candidatos e fases). A chamada usa `store: false`
(a OpenAI não guarda a resposta para consulta) e nenhum log do CRM grava o texto
da mensagem nem o texto devolvido pela API. O aviso de privacidade da IJ deve
mencionar essa transferência ao provedor de LLM — decisão jurídica do usuário.
Com `LLM_PROVEDOR=gemini`, o destinatário é o **Google** (Gemini API); o aviso
deve citá-lo. O que o Google faz com o texto (conferido em 2026-10-27):

- **Retenção para abuso: 55 dias.** "Google retains the following data for
  fifty-five (55) days" — prompts, contexto enviado e respostas — só para
  detectar e prevenir violação de política; acesso humano só por funcionários
  autorizados quando há sinalização, e o dado "is not used to train or
  fine-tune any AI/ML models besides those used specifically for policy
  enforcement" (https://ai.google.dev/gemini-api/docs/usage-policies). A página
  não oferece opção de retenção zero.
- **Serviço pago** (projeto com billing ativo): o Google não usa prompts nem
  respostas para melhorar produtos; processamento sob o Data Processing
  Addendum, podendo armazenar/cachear em qualquer país onde opera
  (https://ai.google.dev/gemini-api/terms).
- **Free tier**: uso para melhorar produtos e revisão humana (mesmos termos) —
  proibido para este CRM.
- **Sem `store: false`:** a chamada `generateContent` que o CRM usa não guarda
  a conversa para consulta posterior e não tem parâmetro equivalente ao
  `store: false` da OpenAI (no SDK, `store` só existe na Interactions API, que
  não usamos). A única retenção é a dos 55 dias acima.

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
