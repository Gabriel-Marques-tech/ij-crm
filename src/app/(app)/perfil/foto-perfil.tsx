"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { enviarFotoAction, removerFotoAction } from "./actions";

const LADO = 256;
const MAX_ENTRADA = 5 * 1024 * 1024;
const MAX_SAIDA = 150 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp"];

type Fonte = { img: CanvasImageSource; w: number; h: number };

async function carregar(arquivo: File): Promise<Fonte> {
  if (typeof createImageBitmap === "function") {
    const b = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    return { img: b, w: b.width, h: b.height };
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blob(canvas: HTMLCanvasElement, tipo: string, q: number): Promise<Blob | null> {
  return new Promise((r) => canvas.toBlob(r, tipo, q));
}

/** WebP (ou JPEG, se o navegador não gera WebP) ≤ 150 KB, baixando a qualidade se preciso. */
async function exportar(canvas: HTMLCanvasElement): Promise<Blob | null> {
  for (const tipo of ["image/webp", "image/jpeg"]) {
    for (const q of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      const b = await blob(canvas, tipo, q);
      if (!b || b.type !== tipo) break; // sem encoder desse tipo: tenta o próximo
      if (b.size <= MAX_SAIDA) return b;
    }
  }
  return null;
}

/**
 * Foto de perfil: escolhe arquivo (JPEG/PNG/WebP ≤ 5 MB), recorta quadrado no
 * navegador (arrastar + zoom) e envia 256×256. O servidor revalida tudo pelos bytes.
 */
export function FotoPerfil({ usuarioId, nome, fotoEm }: { usuarioId: string; nome: string; fotoEm: number | null }) {
  const router = useRouter();
  const [fonte, setFonte] = useState<Fonte | null>(null);
  const [zoom, setZoom] = useState(1);
  const [centro, setCentro] = useState({ x: 0, y: 0 });
  const [falha, setFalha] = useState<FalhaUI | null>(null);
  const setErro = (texto: string | null) => setFalha(texto ? { texto } : null);
  const [pendente, startTransition] = useTransition();
  const canvas = useRef<HTMLCanvasElement>(null);
  const arrasto = useRef<{ x: number; y: number } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const escala = fonte ? (LADO / Math.min(fonte.w, fonte.h)) * zoom : 1;

  function limitar(c: { x: number; y: number }, f: Fonte, s: number) {
    const meio = LADO / 2 / s;
    return { x: Math.min(Math.max(c.x, meio), f.w - meio), y: Math.min(Math.max(c.y, meio), f.h - meio) };
  }

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !fonte) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, LADO, LADO);
    ctx.drawImage(fonte.img, LADO / 2 - centro.x * escala, LADO / 2 - centro.y * escala, fonte.w * escala, fonte.h * escala);
  }, [fonte, centro, escala]);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    setErro(null);
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    if (!TIPOS.includes(arquivo.type)) return setErro("Use uma imagem JPEG, PNG ou WebP.");
    if (arquivo.size > MAX_ENTRADA) return setErro("A imagem passa de 5 MB. Escolha uma menor.");
    try {
      const f = await carregar(arquivo);
      if (f.w < 64 || f.h < 64) return setErro("Imagem pequena demais (mínimo 64×64).");
      setFonte(f);
      setZoom(1);
      setCentro({ x: f.w / 2, y: f.h / 2 });
    } catch {
      setErro("Não foi possível ler essa imagem. Tente outra.");
    }
  }

  function mudarZoom(z: number) {
    if (!fonte) return;
    setZoom(z);
    setCentro((c) => limitar(c, fonte, (LADO / Math.min(fonte.w, fonte.h)) * z));
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!arrasto.current || !fonte) return;
    const fator = LADO / e.currentTarget.getBoundingClientRect().width;
    const dx = (e.clientX - arrasto.current.x) * fator;
    const dy = (e.clientY - arrasto.current.y) * fator;
    arrasto.current = { x: e.clientX, y: e.clientY };
    setCentro((c) => limitar({ x: c.x - dx / escala, y: c.y - dy / escala }, fonte, escala));
  }

  function salvar() {
    const cv = canvas.current;
    if (!cv) return;
    setErro(null);
    startTransition(async () => {
      const b = await exportar(cv);
      if (!b) return setErro("Não foi possível gerar a imagem abaixo de 150 KB. Tente outra foto.");
      const form = new FormData();
      form.set("foto", new File([b], b.type === "image/webp" ? "foto.webp" : "foto.jpg", { type: b.type }));
      const f = await executarAcao(() => enviarFotoAction(form), "enviar a foto");
      if (f) return setFalha(f);
      setFonte(null);
      router.refresh();
    });
  }

  function remover() {
    setErro(null);
    startTransition(async () => {
      const f = await executarAcao(() => removerFotoAction(), "remover a foto");
      if (f) return setFalha(f);
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium">Foto</h2>
      {fonte ? (
        <div className="space-y-3">
          <canvas
            ref={canvas}
            width={LADO}
            height={LADO}
            aria-label="Recorte da foto: arraste para posicionar"
            className="size-48 cursor-grab touch-none rounded-full border border-border-strong active:cursor-grabbing"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              arrasto.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={mover}
            onPointerUp={() => (arrasto.current = null)}
            onPointerCancel={() => (arrasto.current = null)}
          />
          <label className="flex items-center gap-3 text-xs text-fg-mute">
            <span className="eyebrow">zoom</span>
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => mudarZoom(Number(e.target.value))} className="w-40 accent-primary" />
          </label>
          <div className="flex gap-2">
            <Button onClick={salvar} disabled={pendente}>
              {pendente ? "Enviando…" : "Salvar foto"}
            </Button>
            <Button variant="outline" onClick={() => setFonte(null)} disabled={pendente}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <Avatar nome={nome} usuarioId={usuarioId} fotoEm={fotoEm} tamanho="lg" />
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={() => entrada.current?.click()} disabled={pendente}>
              <ImagePlus className="h-4 w-4" />
              {fotoEm ? "Trocar foto" : "Enviar foto"}
            </Button>
            {fotoEm ? (
              <Button variant="ghost" onClick={remover} disabled={pendente}>
                <Trash2 className="h-4 w-4" />
                Remover
              </Button>
            ) : null}
          </div>
        </div>
      )}
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={escolher} />
      <p className="text-xs text-fg-faint">JPEG, PNG ou WebP até 5 MB. O recorte quadrado é feito aqui no navegador.</p>
      <MensagemErro falha={falha} className="text-sm" />
    </section>
  );
}
