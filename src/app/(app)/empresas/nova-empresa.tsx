"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { LinkDuplicado } from "@/components/entidades/link-duplicado";
import { FALHA_CONEXAO, falhaDe, type FalhaUI } from "@/lib/erros/cliente";
import type { Duplicado } from "@/lib/entidades/mensagens";
import { criarEmpresaAction } from "./actions";

export function NovaEmpresa() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState({ nome: "", cnpj: "", dominioEmail: "" });
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [duplicado, setDuplicado] = useState<Duplicado | null>(null);
  const [pendente, startTransition] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await criarEmpresaAction(dados);
        const falha = falhaDe(r, "criar a empresa");
        setErro(falha);
        setDuplicado("duplicado" in r && r.duplicado ? r.duplicado : null);
        if (!falha && "id" in r && r.id) router.push(`/empresas/${r.id}`);
      } catch {
        setErro(FALHA_CONEXAO);
      }
    });
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) {
          setDados({ nome: "", cnpj: "", dominioEmail: "" });
          setErro(null);
          setDuplicado(null);
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus className="h-4 w-4" />
        Nova empresa
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova empresa</DialogTitle>
          <DialogDescription>Só o nome é obrigatório. CNPJ aceita o formato alfanumérico.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ne-nome">Nome</Label>
            <Input id="ne-nome" value={dados.nome} maxLength={200} required autoFocus onChange={(e) => setDados({ ...dados, nome: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ne-cnpj">CNPJ</Label>
            <Input id="ne-cnpj" value={dados.cnpj} placeholder="12.ABC.345/01DE-35" className="font-mono" onChange={(e) => setDados({ ...dados, cnpj: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ne-dominio">Domínio de email</Label>
            <Input id="ne-dominio" value={dados.dominioEmail} placeholder="acme.com.br (ou cole um email/site)" onChange={(e) => setDados({ ...dados, dominioEmail: e.target.value })} />
          </div>
          <MensagemErro falha={erro} />
          <LinkDuplicado duplicado={duplicado} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pendente || !dados.nome.trim()}>
              Criar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
