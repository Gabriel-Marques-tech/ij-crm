import editada from "./editada.json";
import efemera from "./efemera.json";
import fromMe from "./from-me.json";
import imagem from "./imagem.json";
import outroChat from "./outro-chat.json";
import outroEvento from "./outro-evento.json";
import participantAlt from "./participant-alt.json";
import participanteLid from "./participante-lid.json";
import respostaGrupo from "./resposta-grupo.json";
import textoGrupo from "./texto-grupo.json";

/** JID do grupo usado em todas as fixtures (vai em `GRUPO_JID` nos testes). */
export const GRUPO_FIXTURE = "120363000000000001@g.us";

const FIXTURES = {
  "texto-grupo": textoGrupo,
  "resposta-grupo": respostaGrupo,
  "participante-lid": participanteLid,
  "participant-alt": participantAlt,
  efemera,
  editada,
  "from-me": fromMe,
  imagem,
  "outro-evento": outroEvento,
  "outro-chat": outroChat,
} as const;

export type NomeFixture = keyof typeof FIXTURES;

/** Cópia profunda: cada teste pode mexer no payload sem vazar para os outros. */
export function fixtureEvolution(nome: NomeFixture): Record<string, unknown> {
  return structuredClone(FIXTURES[nome]) as unknown as Record<string, unknown>;
}
