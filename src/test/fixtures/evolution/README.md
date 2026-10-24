# Fixtures da Evolution API v2 (`messages.upsert`)

**Derivadas da documentação e do código-fonte da Evolution API v2.3.7** (`prepareMessage` em
`whatsapp.baileys.service.ts` + envelope montado em `webhook.controller.ts`), **não gravadas
de uma instância real**. Antes de dar o parser por fechado, grave payloads reais da instância
da IJ e compare com estes arquivos (follow-up registrado no PR do GAB-28).

| arquivo | cenário |
|---|---|
| `texto-grupo.json` | texto simples no grupo, remetente por telefone, com `#crm` |
| `resposta-grupo.json` | reply (`extendedTextMessage` + `contextInfo.stanzaId`) |
| `participante-lid.json` | remetente entregue como `xxx@lid` |
| `participant-alt.json` | `participant` `@lid` + `participantAlt` com o telefone (Baileys recente) |
| `efemera.json` | `ephemeralMessage` envolvendo um reply (`extendedTextMessage`) |
| `editada.json` | `editedMessage` → `protocolMessage.editedMessage` (edição vira mensagem nova) |
| `from-me.json` | mensagem enviada pela própria instância (ignorar) |
| `imagem.json` | `imageMessage` (sem texto na v1 — ignorar) |
| `outro-evento.json` | `messages.update` (ignorar) |
| `outro-chat.json` | DM fora do `GRUPO_JID` (ignorar) |

O campo `apikey` do envelope é o **token da instância** (`this.token` no `channel.service.ts`),
não a chave global — por isso o README manda criar a instância com `"token": "$EVOLUTION_API_KEY"`.
