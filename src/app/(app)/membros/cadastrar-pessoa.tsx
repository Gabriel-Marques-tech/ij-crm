"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Papel } from "@prisma/client";
import type { AreaPosicoes } from "@/lib/auth/cadastro";
import { ConvidarDialog } from "@/app/(app)/gestao/usuarios/convidar-dialog";

/**
 * "Cadastrar pessoa" na página Membros (GAB-106): o formulário único da Gestão (GAB-105), sem cópia.
 * O botão abre vazio; o cargo vago do organograma chega como `posicaoInicial` (`?cadastrar=`) e abre
 * já na posição. Fechar tira o `?cadastrar=` da URL, para recarregar não abrir de novo.
 * Quem chama remonta este componente a cada posição (`key`).
 */
export function CadastrarPessoa({
  papelAtor,
  googleAtivo,
  posicoes,
  posicaoInicial,
  hrefAoFechar,
}: {
  papelAtor: Papel;
  googleAtivo: boolean;
  posicoes: { areas: AreaPosicoes[]; temAreaGG: boolean };
  posicaoInicial: string | null;
  hrefAoFechar: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(posicaoInicial !== null);
  const [posicao, setPosicao] = useState(posicaoInicial);

  function mudar(v: boolean) {
    setAberto(v);
    if (v) return;
    // Recarrega a página (a pessoa cadastrada já aparece); o próximo clique no botão abre vazio.
    if (posicao !== null) router.replace(hrefAoFechar, { scroll: false });
    else router.refresh();
    setPosicao(null);
  }

  return <ConvidarDialog papelAtor={papelAtor} googleAtivo={googleAtivo} posicoes={posicoes} posicaoInicial={posicao} aberto={aberto} onAbertoChange={mudar} rotuloGatilho="Cadastrar pessoa" />;
}
