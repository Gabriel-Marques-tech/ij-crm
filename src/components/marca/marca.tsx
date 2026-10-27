import Image from "next/image";
import { cn } from "@/lib/utils";
import { MARCA, larguraPara, type NomeMascote } from "./assets";

/** Logo completo (símbolo + "inteli JÚNIOR", texto branco para fundo escuro). */
export function LogoIJ({ altura, className, prioridade = false }: { altura: number; className?: string; prioridade?: boolean }) {
  return (
    <Image
      src={MARCA.logo.src}
      width={larguraPara("logo", altura)}
      height={altura}
      alt="Inteli Júnior"
      priority={prioridade}
      draggable={false}
      className={cn("h-auto max-w-full select-none", className)}
    />
  );
}

/** Só o símbolo (rail lateral estreito, barra do celular). */
export function SimboloIJ({ tamanho, className }: { tamanho: number; className?: string }) {
  return (
    <Image
      src={MARCA.simbolo.src}
      width={tamanho}
      height={tamanho}
      alt="Inteli Júnior"
      priority
      draggable={false}
      className={cn("select-none", className)}
    />
  );
}

/**
 * Mascote da IJ (o bode laranja). `altura` é a de exibição em px: o next/image
 * gera 1x/2x a partir dela e width/height reservam o espaço (sem layout shift).
 * `alt=""` por padrão: nos estados vazios ele é decorativo.
 */
export function Mascote({
  nome,
  altura,
  alt = "",
  className,
  prioridade = false,
}: {
  nome: NomeMascote;
  altura: number;
  alt?: string;
  className?: string;
  prioridade?: boolean;
}) {
  return (
    <Image
      src={MARCA[nome].src}
      width={larguraPara(nome, altura)}
      height={altura}
      alt={alt}
      priority={prioridade}
      draggable={false}
      className={cn("h-auto max-w-full select-none", className)}
    />
  );
}


/** Mascote segurando a placa, com um texto curto (ex.: "403") escrito nela por cima da imagem. */
export function MascotePlaca({ texto, altura = 200, alt }: { texto: string; altura?: number; alt: string }) {
  return (
    <div className="relative inline-block">
      <Mascote nome="placa" altura={altura} alt={alt} prioridade />
      <span
        aria-hidden
        // Área branca da placa no arquivo (434×552): x 142–430, y 240–535; a mão cobre o topo.
        className="absolute top-[54%] left-[33%] flex h-[42%] w-[66%] items-center justify-center font-mono text-2xl font-semibold tracking-tight text-background"
      >
        {texto}
      </span>
    </div>
  );
}
