#!/usr/bin/env bash
# Entrada do deploy automático (GitHub Actions → SSH). Ver docs/runbook.md,
# "Deploy automático (GitHub Actions)".
#
# É o comando FORÇADO da chave do usuário `deploy` no ~/.ssh/authorized_keys:
#
#   command="/opt/ij-crm/scripts/deploy-remoto.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… github-actions-deploy
#
# O sshd roda ESTE script seja qual for o comando pedido pelo cliente; o pedido
# chega em SSH_ORIGINAL_COMMAND. Só é aceita uma tag imutável `sha-<7 a 40 hex>`
# (nada de `latest`, opções, rollback, shell, scp/sftp). Com ela, roda
# `scripts/deploy.sh <tag>` deste repo (o caminho vem da localização do script,
# nunca do ambiente), com a saída passando direto para o cliente, e devolve o
# código de saída do deploy.sh. Uma chave vazada só consegue disparar o deploy
# de uma tag que exista no GHCR (o deploy.sh falha no `docker pull` se não existir).
#
# Saída: a do deploy.sh (0 = ok; ≠ 0 = falhou, inclusive com rollback automático);
# 2 = pedido recusado (nada foi executado).
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pedido="${SSH_ORIGINAL_COMMAND-}"
cliente="${SSH_CLIENT:-local}"
cliente="${cliente%% *}"

registrar() {
  # Trilha no syslog/journal (journalctl -t ij-crm-deploy); sem logger, nada.
  logger -t ij-crm-deploy -- "$*" 2>/dev/null || true
}

if [[ ! "$pedido" =~ ^sha-[0-9a-f]{7,40}$ ]]; then
  # Não ecoa o pedido inteiro (pode ser lixo arbitrário): só o tamanho.
  registrar "recusado: pedido inválido (${#pedido} caracteres) de $cliente"
  echo "deploy-remoto: recusado. Uso: ssh deploy@<host> sha-<commit> (7 a 40 hex minúsculos)" >&2
  exit 2
fi

registrar "deploy de $pedido pedido por $cliente"
echo "deploy-remoto: deploy de $pedido em $RAIZ"
cd "$RAIZ"
# exec: o código de saída é o do deploy.sh, e este arquivo pode ser trocado pelo
# `git pull` do deploy sem afetar nada (o bash não lê mais daqui).
exec "$RAIZ/scripts/deploy.sh" "$pedido"
