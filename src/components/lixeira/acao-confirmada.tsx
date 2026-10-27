"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI, type RespostaAcao } from "@/lib/erros/cliente";

/**
 * Botão → diálogo de confirmação → server action. Com `digitar`, a
 * confirmação é dupla: o botão só libera com o texto exato (o servidor confere
 * de novo). Sucesso: `irPara` (navega) ou recarrega a página atual.
 */
export function AcaoConfirmada({
  rotulo,
  titulo,
  descricao,
  confirmar,
  acao,
  rotuloAcao,
  digitar,
  irPara,
  variante = "outline",
  tamanho = "sm",
}: {
  rotulo: React.ReactNode;
  titulo: string;
  descricao: React.ReactNode;
  confirmar: string;
  acao: (texto: string) => Promise<RespostaAcao>;
  /** Infinitivo para a mensagem de erro: "excluir o card". */
  rotuloAcao: string;
  digitar?: string;
  irPara?: string;
  variante?: "outline" | "destructive" | "ghost" | "default";
  tamanho?: "sm" | "xs" | "default";
}) {
  const idTexto = useId();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const normal = (s: string) => s.trim().replace(/\s+/g, " ");
  const liberado = digitar === undefined || (normal(texto) !== "" && normal(texto) === normal(digitar));

  function executar() {
    startTransition(async () => {
      const falha = await executarAcao(() => acao(texto), rotuloAcao);
      setErro(falha);
      if (falha) return;
      setAberto(false);
      if (irPara) router.push(irPara);
      else router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={variante}
        size={tamanho}
        onClick={() => {
          setTexto("");
          setErro(null);
          setAberto(true);
        }}
      >
        {rotulo}
      </Button>
      <Dialog open={aberto} onOpenChange={(o) => !pendente && setAberto(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>{descricao}</DialogDescription>
          </DialogHeader>
          {digitar !== undefined ? (
            <div className="space-y-1.5">
              <label htmlFor={idTexto} className="text-xs text-fg-mute">
                Digite <b className="font-medium text-foreground">{digitar}</b> para confirmar
              </label>
              <Input id={idTexto} value={texto} autoComplete="off" maxLength={1000} onChange={(e) => setTexto(e.target.value)} />
            </div>
          ) : null}
          <MensagemErro falha={erro} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pendente} onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="button" variant={digitar !== undefined ? "destructive" : "default"} disabled={pendente || !liberado} onClick={executar}>
              {pendente ? "…" : confirmar}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
