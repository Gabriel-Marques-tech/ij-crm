"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { LinkDuplicado } from "@/components/entidades/link-duplicado";
import { BuscaEntidade, type OpcaoBusca } from "@/components/entidades/busca-entidade";
import { FALHA_CONEXAO, falhaDe, type FalhaUI } from "@/lib/erros/cliente";
import type { Duplicado } from "@/lib/entidades/mensagens";
import { buscarEmpresasParaAutocomplete } from "../empresas/buscar";
import { criarContatoAction } from "./actions";

const VAZIO = { nome: "", telefone: "", email: "" };

export function NovoContato() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState(VAZIO);
  const [empresa, setEmpresa] = useState<OpcaoBusca | null>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [duplicado, setDuplicado] = useState<Duplicado | null>(null);
  const [pendente, startTransition] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await criarContatoAction({ ...dados, empresaId: empresa?.id ?? null });
        const falha = falhaDe(r, "criar o contato");
        setErro(falha);
        setDuplicado("duplicado" in r && r.duplicado ? r.duplicado : null);
        if (!falha && "id" in r && r.id) router.push(`/contatos/${r.id}`);
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
          setDados(VAZIO);
          setEmpresa(null);
          setErro(null);
          setDuplicado(null);
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus className="h-4 w-4" />
        Novo contato
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo contato</DialogTitle>
          <DialogDescription>Só o nome é obrigatório. Mais telefones e emails no detalhe.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="nc-nome">Nome</Label>
            <Input id="nc-nome" value={dados.nome} maxLength={200} required autoFocus onChange={(e) => setDados({ ...dados, nome: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="nc-tel">Telefone</Label>
              <Input id="nc-tel" inputMode="tel" value={dados.telefone} placeholder="11 99999-8888" onChange={(e) => setDados({ ...dados, telefone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nc-email">Email</Label>
              <Input id="nc-email" type="email" value={dados.email} onChange={(e) => setDados({ ...dados, email: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Empresa</p>
            {empresa ? (
              <p className="flex items-center gap-2 text-sm">
                {empresa.nome}
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Tirar empresa" onClick={() => setEmpresa(null)}>
                  <X />
                </Button>
              </p>
            ) : (
              <BuscaEntidade rotulo="Buscar empresa" placeholder="opcional — buscar pelo nome" buscar={buscarEmpresasParaAutocomplete} onEscolher={setEmpresa} />
            )}
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
