# shellcheck shell=bash
# Preflight do provedor de LLM (GAB-45), usado por scripts/deploy.sh.
#
#   checar_chave_llm <LLM_PROVEDOR> <OPENAI_API_KEY> <ANTHROPIC_API_KEY>
#
# Recusa (retorno 1, motivo no stderr) quando o provedor selecionado não tem
# chave — senão TODA mensagem #crm iria para FALHA "SEM_CHAVE" em produção.
# Vazio = openai (mesmo padrão do app e do compose.prod.yml). mock e valores
# desconhecidos também são recusados (o app recusa mock em produção).
checar_chave_llm() {
  local provedor chave_openai="$2" chave_anthropic="$3"
  provedor="$(printf '%s' "${1:-openai}" | tr '[:upper:]' '[:lower:]')"
  case "$provedor" in
    openai)
      [[ -n "$chave_openai" ]] && return 0
      echo "ERRO: LLM_PROVEDOR=openai sem OPENAI_API_KEY (runbook §10)" >&2 ;;
    anthropic)
      [[ -n "$chave_anthropic" ]] && return 0
      echo "ERRO: LLM_PROVEDOR=anthropic sem ANTHROPIC_API_KEY (runbook §10)" >&2 ;;
    *)
      echo "ERRO: LLM_PROVEDOR=$provedor inválido em produção (use openai ou anthropic)" >&2 ;;
  esac
  return 1
}
