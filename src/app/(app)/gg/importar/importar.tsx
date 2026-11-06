"use client";

import { useState } from "react";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Chip, Painel, Tabela, diaBR } from "@/components/gg/ui";
import { useAcao } from "@/components/gg/use-acao";
import { Button } from "@/components/ui/button";
import { normalizar, ROTULO_STATUS_MEMBRO, validarImportacao, type LinhaImportacao } from "@/lib/gg/modelo";
import { importarMembrosAction } from "../actions";

const EXEMPLO = `[
  { "nome": "Vitor Hugo", "email": "vitor@ij.test", "status": "ativo", "area": "Projetos", "cargo": "Scrum Master", "entrada": "2026-10-20" },
  { "nome": "Clara Nunes", "status": "ativo", "area": "RH", "cargo": "Analista" }
]`;

/** Prévia com a mesma validação do servidor (`validarImportacao`) e confirmação atômica. */
export function Importar({ areas, cargos, hoje }: { areas: string[]; cargos: string[]; hoje: string }) {
  const [json, setJson] = useState(EXEMPLO);
  const [previa, setPrevia] = useState<LinhaImportacao[] | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  const [feito, setFeito] = useState<number | null>(null);
  const [chave, setChave] = useState(""); // mesma chave nas retentativas desta prévia (idempotente)
  const { pendente, erro, rodar } = useAcao();
  const existe = (lista: string[], v: string | null) => !v || lista.some((x) => normalizar(x) === normalizar(v));

  function revisar() {
    setFeito(null);
    try {
      const linhas = validarImportacao(JSON.parse(json), hoje);
      const ruim = linhas.findIndex((l) => !existe(areas, l.area) || !existe(cargos, l.cargo));
      if (ruim >= 0) throw new Error(`Linha ${ruim + 1}: ${!existe(areas, linhas[ruim].area) ? `área "${linhas[ruim].area}"` : `cargo "${linhas[ruim].cargo}"`} não existe.`);
      setPrevia(linhas);
      setChave(crypto.randomUUID());
      setProblema(null);
    } catch (e) {
      setPrevia(null);
      setProblema(e instanceof SyntaxError ? "JSON inválido." : (e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <Painel>
        <div className="grid gap-3 p-4">
          <label className="grid gap-1.5 text-xs text-fg-mute" htmlFor="json-importacao">
            Lista em JSON (campos: nome, email, status, area, cargo, entrada)
            <textarea id="json-importacao" rows={8} value={json} onChange={(e) => setJson(e.target.value)} className="w-full rounded-lg border border-input bg-transparent p-3 font-mono text-xs dark:bg-input/30" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={revisar}>
              Revisar prévia
            </Button>
            {problema ? <span role="alert" className="text-sm text-danger">{problema}</span> : null}
            {feito !== null ? <span className="text-sm text-success">{feito} membros importados. Revise posições e lideranças no organograma.</span> : null}
          </div>
        </div>
      </Painel>
      {previa ? (
        <Painel titulo="Prévia" contagem={previa.length} acoes={<Button disabled={pendente} onClick={() => rodar(() => importarMembrosAction(json, chave), "importar", (r) => { setFeito(r && "quantidade" in r ? (r.quantidade ?? null) : null); setPrevia(null); })}>Confirmar importação</Button>}>
          <Tabela colunas={["Nome", "E-mail", "Status", "Área · cargo", "Entrada"]}>
            {previa.map((l, i) => (
              <tr key={i}>
                <td>{l.nome}</td>
                <td className="font-mono text-xs">{l.email ?? "—"}</td>
                <td>
                  <Chip>{ROTULO_STATUS_MEMBRO[l.status]}</Chip>
                </td>
                <td className="text-fg-mute">{l.area ? `${l.area} · ${l.cargo}` : "sem posição"}</td>
                <td className="font-mono text-xs">{l.entrada ? diaBR(l.entrada) : "não informada"}</td>
              </tr>
            ))}
          </Tabela>
          <p className="border-t border-border px-4 py-2.5 text-xs text-fg-faint">Datas e e-mails não informados ficam vazios; nada é inventado. Sem posição para área + cargo, o lote cria uma.</p>
          <MensagemErro falha={erro} className="px-4 pb-3 text-sm" />
        </Painel>
      ) : null}
    </div>
  );
}
