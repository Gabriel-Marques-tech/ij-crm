import Link from "next/link";
import { Users, Layers, MessageSquare, Upload, Trash2, Trophy, Settings } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";

const AREAS = [
  { href: "/gestao/usuarios", icon: Users, titulo: "Usuários", desc: "Convites, papéis, telefone do WhatsApp." },
  { href: "/gestao/fases", icon: Layers, titulo: "Fases", desc: "Quadros e fases do funil: ordem, cor, limite de dias, terminais." },
  { href: "/gestao/lixeira", icon: Trash2, titulo: "Lixeira", desc: "Restaurar cards, contatos e empresas excluídos; apagar de vez (admin)." },
  { href: "/gestao/whatsapp", icon: MessageSquare, titulo: "WhatsApp", desc: "Falhas e pendentes, reprocessar, remetentes desconhecidos e descartadas por dia." },
  { href: "/gestao/importar", icon: Upload, titulo: "Importar", desc: "Pipefy → CRM: CSV com prévia, idempotente." },
  { href: "/gestao/ranking", icon: Trophy, titulo: "Ranking", desc: "Pesos da pontuação e se os vendedores veem o ranking." },
  { href: "/gestao/admin", icon: Settings, titulo: "Admin", desc: "Grupo, LLM, limiares, conexão do WhatsApp e logs técnicos.", soAdmin: true },
];

export const metadata = { title: "Gestão" };

export default async function GestaoPage() {
  const u = await exigirUsuario();
  const areas = AREAS.filter((a) => !("soAdmin" in a) || u.papel === "ADMIN");
  return (
    <>
      <PageHeader eyebrow="gestão" title="Gestão" description="Configuração do time e do funil." />
      <div className="grid gap-4 sm:grid-cols-2">
        {areas.map((a) => {
          const Icon = a.icon;
          const conteudo = (
            <>
              <Icon className="mb-3 h-5 w-5 text-primary" />
              <p className="font-medium">{a.titulo}</p>
              <p className="mt-1 text-sm text-fg-mute">{a.desc}</p>
            </>
          );
          const classe = "block rounded-xl border border-border bg-surface p-5 transition-colors";
          return "futuro" in a && a.futuro ? (
            <div key={a.href} className={`${classe} opacity-60`} aria-disabled>
              {conteudo}
            </div>
          ) : (
            <Link key={a.href} href={a.href} className={`${classe} hover:bg-surface-hover`}>
              {conteudo}
            </Link>
          );
        })}
      </div>
    </>
  );
}
