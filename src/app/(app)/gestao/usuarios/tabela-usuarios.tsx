"use client";

import { useActionState, useState, useTransition } from "react";
import type { Area, Cargo, Papel } from "@prisma/client";
import { KeyRound, Pencil, RefreshCw } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { descreverLado } from "@/lib/auth/areas";
import { ROTULO_PAPEL, podeAtribuirPapel, podeGerarRedefinicao } from "@/lib/auth/papeis";
import { alternarAtivoAction, editarUsuarioAction, gerarLinkRedefinicaoAction, reemitirConviteAction, type EstadoConvite } from "./actions";
import { LinkGerado } from "./convidar-dialog";
import { CamposPapelLado } from "./campos-lado";

type Usuario = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  area: Area | null;
  cargos: Cargo[];
  telefoneWhatsapp: string | null;
  ativo: boolean;
  convitePendente: boolean;
  conviteExpiraEm: Date | null;
  redefinicaoPedidaEm: Date | null;
  redefinicaoLinkAtivo: boolean;
  fotoEm: number | null;
};

type Ator = { id: string; papel: Papel };


export function TabelaUsuarios({ usuarios, ator }: { usuarios: Usuario[]; ator: Ator }) {
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [reemitido, setReemitido] = useState<EstadoConvite>(undefined);
  const [redefinicao, setRedefinicao] = useState<(EstadoConvite & { nome?: string }) | undefined>(undefined);
  const [erroLinha, setErroLinha] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function podeMexer(u: Usuario) {
    return podeAtribuirPapel(ator.papel, u.papel);
  }

  function alternar(u: Usuario, ativo: boolean) {
    setErroLinha(null);
    startTransition(async () => {
      const r = await alternarAtivoAction(u.id, ativo);
      if (r?.erro) setErroLinha(r.erro);
    });
  }

  function reemitir(u: Usuario) {
    setErroLinha(null);
    startTransition(async () => {
      const r = await reemitirConviteAction(u.id);
      if (r?.erro) setErroLinha(r.erro);
      else setReemitido(r);
    });
  }

  function gerarRedefinicao(u: Usuario) {
    setErroLinha(null);
    startTransition(async () => {
      const r = await gerarLinkRedefinicaoAction(u.id);
      if (r?.erro) setErroLinha(r.erro);
      else setRedefinicao({ ...r, nome: u.nome });
    });
  }

  // Gestor só para vendedor; admin para qualquer um; ninguém para si (usa Meu perfil); só conta ativa com senha.
  function podeRedefinir(u: Usuario) {
    return podeGerarRedefinicao(ator.papel, u.papel) && u.id !== ator.id && u.ativo && !u.convitePendente;
  }

  return (
    <>
      {erroLinha ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {erroLinha}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="eyebrow px-4 py-3 font-normal">nome</th>
              <th className="eyebrow hidden px-4 py-3 font-normal md:table-cell">email</th>
              <th className="eyebrow hidden px-4 py-3 font-normal sm:table-cell">whatsapp</th>
              <th className="eyebrow px-4 py-3 font-normal">papel</th>
              <th className="eyebrow hidden px-4 py-3 font-normal sm:table-cell">área</th>
              <th className="eyebrow px-4 py-3 font-normal">ativo</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className={`border-b border-border last:border-0 ${u.ativo ? "" : "opacity-50"}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar nome={u.nome} usuarioId={u.id} fotoEm={u.fotoEm} tamanho="sm" />
                    <div className="min-w-0">
                      <div className="font-medium">{u.nome}</div>
                      <div className="text-xs text-fg-faint md:hidden">{u.email}</div>
                      {u.convitePendente ? (
                        <Badge variant="outline" className="mt-1 border-warn/50 text-warn">
                          convite pendente
                        </Badge>
                      ) : null}
                      {u.redefinicaoPedidaEm ? (
                        <Badge variant="outline" className="mt-1 border-danger/50 text-danger">
                          pediu nova senha
                        </Badge>
                      ) : u.redefinicaoLinkAtivo ? (
                        <Badge variant="outline" className="mt-1 text-fg-soft">
                          link de senha ativo
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="hidden px-4 py-3 font-mono text-xs text-fg-soft md:table-cell">{u.email}</td>
                <td className="hidden px-4 py-3 font-mono text-xs text-fg-soft sm:table-cell">
                  {u.telefoneWhatsapp ?? <span className="text-fg-faint">—</span>}
                </td>
                <td className="px-4 py-3">{ROTULO_PAPEL[u.papel]}</td>
                <td className="hidden px-4 py-3 text-fg-soft sm:table-cell">{descreverLado(u)}</td>
                <td className="px-4 py-3">
                  <Switch
                    checked={u.ativo}
                    disabled={pendente || !podeMexer(u) || u.id === ator.id}
                    onCheckedChange={(v) => alternar(u, v)}
                    aria-label={u.ativo ? "Desativar" : "Ativar"}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    {u.convitePendente && podeMexer(u) ? (
                      <Button variant="ghost" size="icon" title="Reemitir convite" aria-label="Reemitir convite" disabled={pendente} onClick={() => reemitir(u)}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {podeRedefinir(u) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Gerar link de redefinição"
                        aria-label="Gerar link de redefinição"
                        disabled={pendente}
                        onClick={() => gerarRedefinicao(u)}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {podeMexer(u) ? (
                      <Button variant="ghost" size="icon" title="Editar" aria-label="Editar" onClick={() => setEditando(u)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-fg-faint">
                  Nenhum usuário ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={reemitido?.link !== undefined} onOpenChange={(o) => !o && setReemitido(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convite reemitido</DialogTitle>
          </DialogHeader>
          {reemitido?.link ? <LinkGerado link={reemitido.link} expiraEm={reemitido.expiraEm} onFechar={() => setReemitido(undefined)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={redefinicao?.link !== undefined} onOpenChange={(o) => !o && setRedefinicao(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link de redefinição de senha{redefinicao?.nome ? ` · ${redefinicao.nome}` : ""}</DialogTitle>
          </DialogHeader>
          {redefinicao?.link ? (
            <LinkGerado
              link={redefinicao.link}
              expiraEm={redefinicao.expiraEm}
              rotulo="link de redefinição"
              aviso="Vale 1 hora e uma única vez; mostrado só agora — se perder, gere outro (o anterior deixa de valer)."
              onFechar={() => setRedefinicao(undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editando !== null} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar {editando?.nome}</DialogTitle>
          </DialogHeader>
          {editando ? <EditarForm usuario={editando} ator={ator} onSalvo={() => setEditando(null)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditarForm({ usuario, ator, onSalvo }: { usuario: Usuario; ator: Ator; onSalvo: () => void }) {
  const [estado, action, pendente] = useActionState(async (prev: Parameters<typeof editarUsuarioAction>[0], form: FormData) => {
    const r = await editarUsuarioAction(prev, form);
    if (r?.ok) onSalvo();
    return r;
  }, undefined);
  const souEu = usuario.id === ator.id;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="usuarioId" value={usuario.id} />
      <div className="space-y-1.5">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" name="nome" defaultValue={usuario.nome} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="telefone">WhatsApp (DDD + número)</Label>
        <Input id="telefone" name="telefone" defaultValue={usuario.telefoneWhatsapp ?? ""} placeholder="11 99999-8888" inputMode="tel" />
        <p className="text-xs text-fg-faint">Deixe vazio para remover. É este número que liga a pessoa às mensagens do grupo.</p>
      </div>
      {!souEu ? <CamposPapelLado papelAtor={ator.papel} papel={usuario.papel} area={usuario.area} cargos={usuario.cargos} /> : null}
      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
