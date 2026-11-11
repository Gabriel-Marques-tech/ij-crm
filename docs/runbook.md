# Runbook de produção — ij-crm

## Produção hoje: Coolify

A produção roda no **Coolify** com `compose.coolify.yml`
([`docs/coolify.md`](coolify.md)):

- **Deploy manual**: botão **Redeploy** no painel depois do merge na `main`. Não
  há deploy automático (o antigo job de deploy via AWS SSM foi removido).
- O Coolify **builda o Dockerfile no servidor** a cada Redeploy; as imagens do
  GHCR (workflow `imagens`) não são usadas lá. O mesmo `next build` roda em todo
  PR (workflow `build`): check vermelho = Redeploy quebraria.
- **Migrations** rodam no serviço one-shot `migrate`, antes do app.
- **Sem backup automático**: antes de deploy com migration, backup do recurso
  PostgreSQL no painel ou `pg_dump` à mão.

**O resto deste runbook** (checklist de go-live, §0–§3, §7, §8) descreve a
instalação **standalone** (`compose.prod.yml` + `scripts/deploy.sh` numa VM
própria, ex. EC2), que **não é a produção atual**: fica como referência e plano B.
As seções de operação do app (§4–§6, §9–§11) valem para os dois, trocando o `dc`
pelos containers do Coolify.

## Instalação standalone

Operação da VPS (GAB-30). Stack: `compose.prod.yml` com `caddy` (únicas portas
públicas: 80/443, só o app), `app`, `db` (Postgres 16), `evolution` +
`evolution-db` + `evolution-redis` (sem rota pública: porta só em `127.0.0.1`
da VPS) e o one-shot `migrate` (perfil `ops`). Repo em `/opt/ij-crm`.

## Checklist de go-live (standalone)

Do zero ao ar, em ordem. Cada passo aponta para a seção com os comandos
(`dc` = alias definido logo abaixo; tudo roda em `/opt/ij-crm`).

1. **Instância**: EC2 `t3.small` (x86_64, 2 GiB), Ubuntu 24.04 LTS, disco gp3 de
   20–30 GiB e **2 GiB de swap** em arquivo ([§11](#11-recursos-limites-medição-e-instância-mínima)).
   IP elástico. Security group: **só** 80 e 443 TCP de entrada (443 UDP opcional,
   HTTP/3). **Sem porta 22**: acesso de admin pelo Session Manager. **Não** abra
   8080 nem 3000. Instance profile com `AmazonSSMManagedInstanceCore` e agente
   SSM `Online` (para o Session Manager).
2. **Docker Engine + plugin compose v2** ([§0, "Docker na VPS"](#docker-na-vps)) e o
   **usuário `deploy`** no grupo `docker` (["Usuário `deploy`"](#usuário-deploy-e-o-risco-aceito-standalone)).
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
14. **Por último**: `NOTIFICATIONS_ENABLED=true` no `.env` e `scripts/deploy.sh`.
    Mandar um `#crm` de teste e conferir a confirmação no grupo.

Atalho usado em todo este documento (rode na raiz do repo):

```bash
alias dc='docker compose -f compose.prod.yml'
```

| Arquivo | Para quê |
|---|---|
| `scripts/deploy.sh` | deploy (`checa → git fetch + checkout do commit da tag → docker pull (por digest com `--digest-*`) → backup → migrate → up → health`) e `rollback` por tag |
| `.github/workflows/imagens.yml` | CI: builda as imagens `app` e `ops` a cada push na `main` e publica no GHCR (sem deploy) |
| `.github/workflows/build.yml` | CI: `prisma generate` + `next build` em todo PR para a `main` (o build do Coolify) |
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
`/opt/ij-crm` (["Usuário `deploy`"](#usuário-deploy-e-o-risco-aceito-standalone)). Acesso pelo
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

Standalone (produção no Coolify: [`docs/coolify.md`](coolify.md)). Fluxo: merge
na `main` → o workflow **imagens** (GitHub Actions) builda e publica `ij-crm-app`
e `ij-crm-ops` com as tags `sha-<commit curto>` e `latest` (≈ 5–10 min;
acompanhe na aba Actions) → na VM, como `deploy` (`sudo -iu deploy`), roda-se o
`scripts/deploy.sh` à mão (não há deploy automático):

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
   `--digest-app=sha256:… --digest-ops=sha256:…` (opcional, digests do resumo do
   workflow `imagens`): baixa `<imagem>@<digest>` em vez da tag (tags do GHCR são mutáveis) e
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

### Ciclo único (GAB-81): deploy com migração de dados

A migration `20261030130000_ciclo_unico` **mexe em dados** (une cada par venda →
card de projetos num Projeto só, cria/adota os marcos, reordena as fases e grava
`vendedor_id`). O Prisma roda o arquivo como um script só: é tudo ou nada (sem
`BEGIN`/`COMMIT` explícitos). É idempotente e não apaga nada (o card de projetos
absorvido fica soft-deletado com `absorvido_por_id`), mas **não tem volta
automática**: o rollback é restaurar o dump.

**Pares não unidos** (decisão do usuário): se a venda saiu do ganho (reaberta ou
perdida depois do ganho) e o card de projetos está vivo, os dois **ficam
separados** — a venda em Vendas, o projeto em Projetos —, com o
`origem_oportunidade_id` intacto e uma Timeline `ciclo_unico_nao_unido` em cada
um. A 2ª saída de `scripts/verificar-ciclo-unico.sql` lista esses pares (id,
título, fase e responsável de cada lado), antes e depois. Na Timeline, cada um
linka o outro. Se a venda de um par não unido for **ganha de novo**, ela segue
para o Handoff como card próprio (o projeto da v1 não é mexido) e os dois cards
ganham um aviso `reganho_projeto_existente` com link um para o outro — a gestão
decide se arquiva um deles.

Neste deploy, na ordem:

1. **`pg_dump` de produção antes de tudo** (além do backup automático do
   `deploy.sh`, que no Coolify não existe):
   ```bash
   # standalone (compose.prod.yml)
   scripts/backup.sh                      # ou: dc exec -T db pg_dump -U ijcrm -d ijcrm -Fc > /var/backups/ij-crm/ijcrm-pre-gab81.dump
   # Coolify: backup do recurso PostgreSQL no painel, ou no host:
   docker exec <container-postgres-do-crm> pg_dump -U <usuario> -d <banco> -Fc > ijcrm-pre-gab81.dump
   ls -l ijcrm-pre-gab81.dump && pg_restore --list ijcrm-pre-gab81.dump | grep -c 'TABLE DATA'   # confere que o dump abre
   ```
2. **Contagens antes** (só leitura: o script roda dentro de `BEGIN READ ONLY … ROLLBACK`):
   `psql "$DATABASE_URL" -f scripts/verificar-ciclo-unico.sql > antes.txt`
   (no container: `... psql -U <usuario> -d <banco> < scripts/verificar-ciclo-unico.sql`).
   Se puder, rode antes a migration numa **cópia** do dump (`createdb copia &&
   pg_restore -d copia ijcrm-pre-gab81.dump && DATABASE_URL=…/copia prisma migrate deploy`)
   e compare as contagens da cópia.
3. Deploy normal (`prisma migrate deploy` roda a migration). Os `RAISE NOTICE`
   da migration **não aparecem** no log do `migrate deploy`: o resultado se confere
   no passo 4, com o script.
4. **Contagens depois**, mesmo script, `> depois.txt`, e confira as relações
   listadas no topo de `scripts/verificar-ciclo-unico.sql` (ex.:
   `projetos_entidades` depois = `cards_total` antes − `cards_absorvidos` depois;
   `pares_venda_projeto` depois = `pares_nao_unidos`; `marcos` = 7;
   transições/prazos/mensagens iguais; a lista de não unidos igual à de antes).
   Na tela: Gestão → Fases mostra os marcos; um card ganho antigo abre com a
   Timeline da venda e do projeto juntas.
5. **Rollback** (algo errado nos dados): primeiro o app volta para a tag
   anterior, depois o banco volta para o dump do passo 1. Standalone:
   `scripts/deploy.sh rollback sha-<anterior>` e então `scripts/restore.sh <dump>`
   (o `migrate deploy` que o restore roda usa a tag do app, que não conhece esta
   migration: ela não é reaplicada). Coolify: redeploy do commit anterior e
   restauração do backup do recurso PostgreSQL (ou `pg_restore --clean --if-exists
   --no-owner --single-transaction -d <banco> ijcrm-pre-gab81.dump`). Escritas
   feitas entre o deploy e o restore se perdem. Só trocar o app (sem restaurar)
   também funciona — a versão anterior lê o banco migrado —, mas os cards
   continuam unidos.

Migração falhou: o Postgres desfaz tudo (nada fica pela metade) e o
`migrate deploy` sai com **P3018**, mostrando a mensagem do erro (ex.:
`ciclo único: marcos inconsistentes depois da migração`, ou o erro de SQL). O app
antigo segue no ar. O **próximo** deploy vai parar com **P3009** (migration
marcada como falhada) até alguém resolver: corrija o problema (dado ou SQL num
commit novo) e marque a tentativa como desfeita antes de fazer deploy de novo:

```bash
prisma migrate resolve --rolled-back 20261030130000_ciclo_unico
# standalone: dc --profile ops run --rm migrate prisma migrate resolve --rolled-back 20261030130000_ciclo_unico
```

Veja também "Migration falhou" (§2).

## Proteção da `main` e checks de PR

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

O check **`next-build`** (workflow `build`) roda em todo PR o mesmo `next build`
do Coolify: vermelho = o Redeploy quebraria. Ainda **não** é obrigatório; para
tornar, acrescente `{ "context": "next-build", "app_id": 15368 }` em `checks` do
JSON e rode o PUT acima.

### Usuário `deploy` e o risco aceito (standalone)

Usuário dedicado, sem senha nem chave SSH, no grupo `docker`, dono de
`/opt/ij-crm` (repo, `.env`, `.deploy/`), `/var/backups/ij-crm`,
`/var/log/ij-crm`, do crontab e do `~/.config/rclone`. Admin opera como ele via
`sudo -iu deploy` (Session Manager, se a VM for EC2 sem SSH).

**Risco aceito: `scripts/` é gravável pelo `deploy`.** O deploy faz `git
checkout` do commit da tag, que reescreve `scripts/`, `compose.prod.yml` e
`Caddyfile`; com `scripts/` de root e só leitura, o checkout quebra. Na prática
não muda nada: o `deploy` está no grupo `docker`, que já equivale a root no host,
e ninguém de fora chega a um shell dele (sem SSH).

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

### Anexos dos Projetos (volume `app_anexos`, GAB-84)

Os arquivos anexados aos Projetos **não estão no banco**: o banco guarda só os
metadados (nome, tipo, tamanho, sha256, autor, texto extraído). Os bytes ficam
no volume nomeado `app_anexos`, montado em `/data/anexos` no serviço `app`
(`ANEXOS_DIR`), um arquivo por anexo com o id como nome. **Nenhum backup
automático cobre esse volume** (nem o `backup.sh`, nem o backup do recurso
PostgreSQL no Coolify): faça à mão, junto com o do banco.

Achar o container do app (o volume e o caminho aparecem no `inspect`):

```bash
# standalone (compose.prod.yml): use `dc exec -T app ...` nos comandos abaixo no lugar de `docker exec -i "$APP" ...`
# Coolify: o nome do container leva o UUID do recurso
docker ps --format '{{.Names}}' | grep '^app'
APP=<nome-do-container-app>
docker inspect -f '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' "$APP"   # deve listar … -> /data/anexos
```

**Backup** (com o app no ar; o app grava cada arquivo inteiro de uma vez, então
não há arquivo pela metade — só `*.tmp` em trânsito, que ficam de fora):

```bash
docker exec "$APP" tar czf - --exclude='*.tmp' -C /data/anexos . > /var/backups/ij-crm/anexos-$(date -u +%Y%m%dT%H%M%SZ).tar.gz
tar tzf /var/backups/ij-crm/anexos-<UTC>.tar.gz | wc -l   # nº de arquivos ≈ select count(*) from anexo
```

Faça o dump do banco **antes** do tar: assim todo anexo do dump tem arquivo no
tar (arquivo a mais, de um upload entre os dois, é inofensivo). Para off-site:
`rclone copy /var/backups/ij-crm/anexos-<UTC>.tar.gz "$BACKUP_REMOTE"`.

**Restore** (depois de restaurar o banco, com o app no ar; o `tar` roda como o
usuário `node` do container, então os arquivos já saem com o dono certo):

```bash
docker exec -i "$APP" tar xzf - -C /data/anexos < /var/backups/ij-crm/anexos-<UTC>.tar.gz
docker exec "$APP" sh -c 'ls /data/anexos | wc -l'
```

Anexo sem arquivo (volume perdido, restore incompleto): o detalhe do Projeto
lista normalmente, mas o download responde 500 com `ref`; o log tem
`[api.anexos.download] ref=… ENOENT`. O texto extraído continua no banco.

**Nunca** `docker compose down -v` nem "Delete volumes" no Coolify: apaga os anexos.

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

## 12. Conector MCP: conectar o Claude ao CRM (GAB-83)

O CRM é um servidor MCP remoto com login OAuth. Cada pessoa conecta o próprio
Claude e ele age **em nome dela, com o papel dela** (visualizador só lê). Tudo
que o Claude grava aparece na Timeline do projeto com o nome da pessoa e a
marca **“via MCP”**. Excluir de vez, mesclar contatos e configurações ficam só
na tela.

**URL do conector:** `https://<APP_DOMAIN>/api/mcp` (o perfil de cada pessoa
mostra a URL exata). Ela deriva de `APP_URL`: se `APP_URL` estiver errada, o
`issuer` e o `resource` do OAuth ficam errados e nenhum cliente conecta.

### claude.ai (web) e Claude Desktop

1. Configurações → **Conectores** → **Adicionar conector personalizado**
   (em plano Team/Enterprise, quem adiciona é o Owner da organização; depois
   cada pessoa só clica em **Conectar**).
2. Nome: `ij-crm`. URL: `https://<APP_DOMAIN>/api/mcp`. Deixe client ID e
   segredo **vazios** (o Claude se registra sozinho, por DCR).
3. **Conectar** → abre o CRM → login (se preciso) → tela “Conectar ao CRM”
   com o nome do cliente e o host de retorno (`claude.ai`) → **Autorizar**.
4. Numa conversa, ative o conector e peça, por exemplo, “liste meus projetos
   em negociação”.

O Desktop usa a mesma conta do claude.ai: o conector adicionado lá aparece no
Desktop (e no celular) sem passo extra.

### Claude Code

```bash
claude mcp add --transport http ij-crm https://<APP_DOMAIN>/api/mcp
# dentro do Claude Code: /mcp → ij-crm → Authenticate (abre o navegador)
```

O Claude Code recebe o código numa porta local (`http://localhost:<porta>/callback`);
a tela de autorização avisa quando o retorno é para `localhost`.

### Ver e revogar

- **Perfil → Conexões do Claude (MCP)**: lista cada conexão (cliente, quando
  conectou, último uso) com **Revogar**, que corta na hora.
- Trocar ou redefinir a senha e desativar o usuário também derrubam todas as
  conexões MCP dele (como as sessões).
- Mudança de papel vale na próxima chamada (o papel é lido a cada request).

### Como funciona (para depurar)

| Endpoint | Para quê |
|---|---|
| `POST /api/mcp` | MCP (Streamable HTTP, sem sessão, resposta JSON). Sem token → `401` com `WWW-Authenticate: Bearer resource_metadata=…` |
| `GET /.well-known/oauth-protected-resource/api/mcp` (e na raiz) | metadados do recurso (RFC 9728) |
| `GET /.well-known/oauth-authorization-server` | metadados do OAuth (RFC 8414) |
| `POST /api/oauth/register` | registro dinâmico (RFC 7591); só cliente público; 20/h por IP |
| `GET /oauth/autorizar` | login + consentimento (PKCE S256 obrigatório) |
| `POST /api/oauth/token` | código → tokens; refresh com rotação |
| `POST /api/oauth/revoke` | revogação (RFC 7009) |

- Access token: 1 h. Refresh: 30 dias, renovado a cada uso (o antigo morre).
  Banco guarda só sha256 (`mcp_conexao`, `oauth_codigo`). Clientes registrados
  que nunca conectaram somem após 7 dias.
- Refresh já usado que reaparece = cópia vazada ou replay: a conexão inteira é
  apagada (log `[auditoria] mcp.refresh_reusado`) e a pessoa conecta de novo.
  Se alguém relatar "o Claude desconectou sozinho", procure essa linha.
- O app manda `X-Frame-Options: DENY` e `frame-ancestors 'none'` em toda rota
  (`next.config.ts`), porque no Coolify não há Caddy para isso: a tela de
  autorização não pode ser embutida (clickjacking).
- Erro numa ferramenta: o Claude recebe a mensagem da regra (a mesma da tela)
  ou `Erro no servidor (ref: abcd1234)`; no log, `grep 'ref=abcd1234'` mostra
  `[mcp.<ferramenta>] ref=abcd1234 <causa>`. Falhas do OAuth logam como
  `[mcp.oauth.*]`.
- Testar a descoberta de fora: `curl -i -X POST https://<APP_DOMAIN>/api/mcp`
  deve dar `401` com o header acima, e
  `curl https://<APP_DOMAIN>/.well-known/oauth-authorization-server` o JSON.
- O claude.ai chama o servidor a partir de `160.79.104.0/21`: se um dia houver
  firewall/WAF na frente do Caddy, libere essa faixa.
- “Couldn't reach the MCP server” no claude.ai quase sempre é descoberta: confira
  os dois `curl` acima e o `APP_URL`.

## 13. Propostas: rascunho, versões e conflito (GAB-86)

Uma proposta por Projeto (`proposta.oportunidade_id` é único), aberta em
`/projetos/<id>/proposta`; a aba **Propostas** (`/propostas`) lista todas.

- **Quem cria:** quem é de vendas e responsável pelo Projeto, e a gestão
  (`podeCriarProposta` em `src/lib/propostas/regras.ts`).
- **Quem edita: o dono da caneta** (GAB-87, ver §13.1). Todo o resto lê.
- **Fonte da verdade do texto:** Markdown canônico em `proposta.conteudo_md`
  (é o que o MCP lê e escreve). O editor recebe o JSON derivado; o servidor
  converte de volta e grava só Markdown. Formatação: títulos 1–3, negrito,
  itálico, listas e linha horizontal — o resto vira texto literal.
- **Rascunho x versão:** o autosave grava o rascunho (não é versão, não vai
  para a Timeline). "Salvar versão" grava `proposta_versao` (v1, v2…), que o
  banco não deixa alterar (trigger `proposta_versao_sem_update`). Criação e
  cada versão entram na Timeline do Projeto (tipo `PROPOSTA`).
- **Conflito:** cada gravação manda a `revisao` que leu. Se outra aba, outra
  pessoa ou o Claude (MCP) gravou antes, nada é sobrescrito: a tela mostra quem
  alterou e pede para escolher (carregar a atual ou manter a sua). No MCP a
  ferramenta responde para ler de novo (`ler_proposta`).
- **Erros:** a tela mostra `ref`; no log, `grep 'ref=<ref>'` mostra
  `[proposta.salvarTexto|salvarEstruturado|salvarVersao|criar] ref=<ref> <causa>`
  (pelo MCP, `[mcp.<ferramenta>]`).

### 13.1 Caneta e pingue-pongue (GAB-87)

Máquina de estados pura em `src/lib/propostas/caneta.ts`, aplicada no serviço
(`propostas.ts`) sob o lock da linha da proposta — vale para tela e MCP.

- **Caneta** = `proposta.caneta_com_id` + `caneta_lado`. Só o dono (ativo, que
  escreve e ainda do lado da caneta) grava rascunho/versão; o Claude dele via MCP
  age como ele. Começa em vendas (com o responsável, se é de vendas; senão
  ninguém). Gestão sem lado não age na caneta.
- **Troca de mão** só quando o dono **passa** (mesmo lado) ou **devolve** (outro
  lado: salva versão; status Em análise/Em ajuste). Exceção: o **GP do lado**
  (cargo, GAB-82) **pega** — destrava quando o dono sumiu ou ninguém está com ela.
- **Concordar**: só se a última versão veio do outro lado e o rascunho é igual a
  ela → **Pronta para envio** (a caneta fica com vendas). **Reabrir** volta para
  Em ajuste. **Inviável** (PM de projetos ou dono do lado projetos, com motivo):
  status Inviável e o Projeto vai para Perdido pelo mesmo caminho do Kanban.
- **Concorrência:** autosave, salvar versão e toda ação da caneta travam a
  linha da proposta (`FOR UPDATE`), e toda mudança de caneta/status incrementa
  `proposta.revisao` — um autosave em voo de quem acabou de passar a caneta vira
  conflito, nunca escrita sem caneta. A tela adota a revisão nova devolvida.
- **Inviável tem volta:** reabrir o card (sair de Perdido pelo Kanban) leva a
  proposta para Em ajuste, sem ninguém com a caneta (o GP de vendas pega).
- **Gestão desativa/troca o lado do dono:** a caneta fica sem dono e o período
  fecha (`liberarCanetasDe`, `src/lib/propostas/caneta-banco.ts`).
- **Tempo com a caneta**: cada posse é um período em `proposta_caneta`
  (`inicio`/`fim`; aberto = `fim` nulo). Somar por pessoa para o painel.
- **Diff**: `/projetos/<id>/proposta/diff?de=&para=` (e `ver_diff_proposta`).
- **Avisos** (GAB-88): `src/lib/propostas/avisos.ts` — o serviço chama
  `avisarCaneta` depois do commit; registre um ouvinte com `aoMudarCaneta`.
- **Destravar na mão** (ex.: ninguém com a caneta e não há GP): dê o cargo GP a alguém do
  lado na Gestão e peça para pegar — não edite `caneta_com_id` direto (o período
  em `proposta_caneta` ficaria aberto para a pessoa errada).
- **Erros:** `[proposta.passarCaneta|devolver|concordar|pegarCaneta|reabrir|inviavel] ref=<ref>`.

### 13.2 Proposta a partir de arquivo (GAB-90)

- **Arquivo como base (GAB-90):** falha da IA ao ler um anexo não mexe no
  rascunho; a tela/MCP mostram `ref` e o log tem
  `[proposta.preencher anexo=<12 hex> modo=texto|arquivo] ref=<ref> LLM <CÓDIGO>`
  e a linha `[llm] proposta_arquivo ref=<ref>:<anexo> … tokens_in=… tokens_out=…`
  (também em Admin → Logs, `operacao=proposta_arquivo`). `SEM_CREDITO` dispara o
  mesmo alerta/banner de crédito do WhatsApp. Escaneado grande demora (timeout de
  120 s, tentativa única); `TRUNCADA` = documento longo demais para uma leitura.
  Outras recusas, sem chamar a IA: "leitura em andamento" (limite de 2 no
  processo, 1 por pessoa), PDF acima de 30 páginas, e anexo cujo arquivo sumiu
  do disco (`ENOENT` no log com a ref: restaure o volume `app_anexos` ou peça
  para reenviar).

### 13.3 Envio, resposta do cliente e trava de contrato (GAB-89)

Regras puras em `src/lib/propostas/envio.ts`; serviço em `propostas.ts` (mesmo
lock da proposta, mesma ordem do Kanban: quadro → proposta; toda transição
incrementa a revisão).

- **PDF** (`GET /api/projetos/<id>/proposta/pdf?versao=N`, `gerar_pdf_proposta`):
  versão final (pronta) ou a enviada, texto + parte estruturada. Gerador em
  `src/lib/pdf/` (pdf-lib + Inter embutida em subconjunto, sem navegador);
  **template** separado em `src/lib/pdf/templates/` — trocar pelo oficial da IJ =
  novo `TemplatePdf` + `templateAtual()`. As fontes vêm de `src/lib/pdf/fontes/`
  (no standalone por `outputFileTracingIncludes`; o CI confere). Fonte faltando →
  500 com `[api.proposta.pdf] ref=<ref>`. No máximo 2 gerações ao mesmo tempo no
  processo; a 3ª recebe 503 com ref (`[api.proposta.pdf] ref=<ref> PDF_OCUPADO`).
- **Enviada**: vendas (dono da caneta ou GP de vendas) marca; grava
  `versao_enviada`. O sistema não manda nada ao cliente.
- **Resposta**: Aceita → Projeto para **Montando contrato** (`registrarMovimento`);
  Recusada → motivo da lista do Kanban, Projeto para **Perdido**; Revisão pedida →
  caneta com quem registrou. Concluir a revisão direto só se a parte estruturada é
  a da versão enviada; senão Devolver para projetos. Card recusado reaberto pelo
  Kanban → proposta volta como Revisão pedida.
- **Trava** (`src/lib/projetos/trava-contrato.ts`): Montando contrato e tudo depois
  dele em Vendas (subfases, Ganho) só com proposta **Aceita** — Kanban, MCP,
  WhatsApp (não move, `revisar`, o grupo recebe o que falta) e card novo. Nem
  gestor força. **Cards que já existiam no deploy são isentos**
  (`oportunidade.isento_trava_contrato`, marcado em todos pela migration
  `20261101200000_envio_proposta` na hora em que ela roda; o import do Pipefy
  também marca); só os criados depois exigem a proposta aceita. Isentar um card na
  mão (exceção combinada com a gestão): `UPDATE oportunidade SET
  isento_trava_contrato = true WHERE id = '<id>'`. Além disso, card que já está em
  Montando contrato ou além anda livre lá dentro; saindo de Perdido conta onde foi
  perdido. Import do Pipefy não passa
  pela trava. A lixeira (restaurar escolhendo fase) e a Gestão de fases também
  respeitam: remover fase migrando para lá → `DESTINO_EXIGE_PROPOSTA`; reordenar
  uma subfase com cards sem aceite para depois do marco → `FASE_CRUZA_CONTRATO`. **Card legado parado antes do marco** que já fechou: não há atalho —
  crie a proposta, leve-a a Pronta, marque enviada e registre o aceite.
- **Erros:** `[proposta.enviada|resposta|concluirRevisao] ref=<ref>`, `[api.proposta.pdf] ref=<ref>`.
