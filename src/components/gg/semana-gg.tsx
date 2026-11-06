import Link from "next/link";
import { db } from "@/lib/db";
import { LIMITE_DEMANDA, ROTULO_EVENTO, semestreDe } from "@/lib/gg/modelo";
import { eventosDoUsuario, saldoDemandas } from "@/lib/gg/rotina";
import { Chip, diaBR } from "./ui";

const TOM = { RG: "coral", REUNIAO: "gg", EVENTO: "aviso" } as const;

/**
 * Ponte G&G → Minha Semana: RGs e reuniões da semana que dizem respeito à pessoa
 * (IJ inteira ou a área dela no organograma) e o saldo de demandas Rosa/Azul.
 * Sem membro ligado à conta, só os eventos da IJ inteira.
 */
export async function SemanaGG({ usuarioId, segunda, domingo, hoje }: { usuarioId: string; segunda: string; domingo: string; hoje: string }) {
  const [eventos, membro] = await Promise.all([eventosDoUsuario(usuarioId, segunda, domingo), db.membro.findUnique({ where: { usuarioId }, select: { id: true } })]);
  const saldo = membro ? await saldoDemandas(membro.id, semestreDe(hoje)) : null;
  if (!eventos.length && !saldo) return null;
  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className="size-1.5 rounded-full bg-chart-5" />
        <h2 className="flex-1 text-sm font-medium">Gente &amp; Gestão</h2>
        <Link href="/gg/agenda" className="text-xs text-fg-mute underline">
          agenda
        </Link>
      </div>
      <ul className="space-y-1.5 text-sm">
        {eventos.map((e) => (
          <li key={e.id} className="flex items-center gap-2">
            <span className="w-11 font-mono text-[11px] text-fg-faint">{diaBR(e.data).slice(0, 5)}</span>
            <Chip tom={TOM[e.categoria]}>{ROTULO_EVENTO[e.categoria]}</Chip>
            <span className="min-w-0 flex-1 truncate">
              {e.titulo}
              {e.horario ? <span className="text-fg-faint"> · {e.horario}</span> : null}
            </span>
          </li>
        ))}
        {!eventos.length ? <li className="text-xs text-fg-faint">Sem RG ou reunião nesta semana.</li> : null}
      </ul>
      {saldo ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-fg-mute">
          Demandas {semestreDe(hoje)}:
          <span className="font-mono">
            {saldo.ROSA}/{LIMITE_DEMANDA.ROSA} rosas
          </span>
          <span className="font-mono">
            {saldo.AZUL}/{LIMITE_DEMANDA.AZUL} azuis
          </span>
          {saldo.AZUL >= LIMITE_DEMANDA.AZUL || saldo.ROSA >= LIMITE_DEMANDA.ROSA ? <Chip tom="aviso">no limite</Chip> : null}
        </p>
      ) : null}
    </section>
  );
}
