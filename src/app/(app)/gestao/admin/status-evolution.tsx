"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { EstadoConexao } from "@/lib/whatsapp/evolution-admin";
import { mostrarQrAction } from "./actions";

const ROTULO: Record<EstadoConexao, { texto: string; cor: string }> = {
  CONECTADO: { texto: "conectada", cor: "text-success" },
  AGUARDANDO_QR: { texto: "aguardando leitura do QR", cor: "text-warn" },
  DESCONECTADO: { texto: "desconectada", cor: "text-danger" },
  DESCONHECIDO: { texto: "estado desconhecido", cor: "text-warn" },
};

/**
 * Estado da instância + QR sob demanda. O QR vincula o WhatsApp: vem de uma
 * action só-ADMIN, fica só na memória deste componente e some ao fechar.
 */
export function StatusEvolution({ conexao }: { conexao: { ok: true; estado: EstadoConexao } | { ok: false; erro: string } }) {
  const [qr, setQr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function mostrar() {
    setAviso(null);
    iniciar(async () => {
      const r = await mostrarQrAction();
      if (!r.ok) return setAviso(r.erro);
      if (r.qr === null) return setAviso("A instância já está conectada: não há QR para ler.");
      setQr(r.qr);
    });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">whatsapp (evolution)</p>
          {conexao.ok ? (
            <p className={`text-sm font-medium ${ROTULO[conexao.estado].cor}`}>Instância {ROTULO[conexao.estado].texto}</p>
          ) : (
            <p role="alert" className="text-sm text-danger">
              {conexao.erro}
            </p>
          )}
        </div>
        {qr ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setQr(null)}>
            Esconder QR
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={mostrar}>
            {pendente ? "Buscando…" : "Mostrar QR"}
          </Button>
        )}
      </div>
      {aviso ? <p className="mt-3 text-sm text-fg-mute">{aviso}</p> : null}
      {qr ? (
        <div className="mt-4 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL efêmera, sem otimização */}
          <img src={qr} alt="QR para vincular o WhatsApp" className="h-64 w-64 rounded-lg bg-foreground p-2" />
          <p className="text-xs text-fg-faint">No celular do número do CRM: WhatsApp → Aparelhos conectados → Conectar. O QR expira em segundos; peça outro se precisar.</p>
        </div>
      ) : null}
    </section>
  );
}
