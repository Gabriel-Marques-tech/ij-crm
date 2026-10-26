"use client";

import { useState } from "react";
import { cn } from "cn";

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase() || "?";
}

const TAMANHOS = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-24 text-2xl",
} as const;

export type TamanhoAvatar = keyof typeof TAMANHOS;

/** URL da foto com cache-bust pela versão (`usuario_foto.atualizado_em`). */
export function urlFoto(usuarioId: string, fotoEm: number): string {
  return `/api/usuarios/${encodeURIComponent(usuarioId)}/foto?v=${fotoEm.toString(36)}`;
}

/**
 * Avatar único do app (GAB-43): foto quando o usuário tem (`fotoEm` ≠ null),
 * iniciais caso contrário — e também se a foto falhar ao carregar (404/rede).
 * Sem `fotoEm` nenhum request é feito.
 */
export function Avatar({
  nome,
  usuarioId,
  fotoEm,
  tamanho = "xs",
  rotulo,
  className,
}: {
  nome: string;
  usuarioId?: string | null;
  fotoEm?: number | null;
  tamanho?: TamanhoAvatar;
  /** Texto acessível; padrão = nome. */
  rotulo?: string;
  className?: string;
}) {
  const src = usuarioId && fotoEm ? urlFoto(usuarioId, fotoEm) : null;
  const [falhou, setFalhou] = useState<string | null>(null);
  const classe = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-strong bg-surface-strong font-mono text-fg-soft",
    TAMANHOS[tamanho],
    className,
  );
  if (src && falhou !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- rota autenticada própria; next/image não ajuda aqui
      <img src={src} alt={rotulo ?? nome} title={nome} className={cn(classe, "object-cover")} loading="lazy" decoding="async" onError={() => setFalhou(src)} />
    );
  }
  return (
    <span title={nome} role="img" aria-label={rotulo ?? nome} className={classe}>
      {iniciais(nome)}
    </span>
  );
}
