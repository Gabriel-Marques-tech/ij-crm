import { Painel } from "@/components/gg/ui";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { ehEditorGG } from "@/lib/gg/organizacao";
import { carregarBase } from "@/lib/gg/organizacao";
import { Importar } from "./importar";

export const metadata = { title: "Importar membros · G&G" };

export default async function ImportarPage() {
  const ator = await exigirUsuario();
  const editor = await ehEditorGG(ator);
  const base = editor ? await carregarBase() : null;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="gente & gestão · importação" title="Importar membros" description="Até 500 por vez. Área e cargo precisam existir no catálogo. Tudo ou nada: uma linha inválida recusa o lote inteiro." />
      {/* O item fica no menu de todos; quem não edita G&G lê o porquê em vez de cair no 403. */}
      {base ? (
        <Importar areas={base.areas.map((a) => a.nome)} cargos={base.cargos.map((c) => c.nome)} hoje={base.hoje} />
      ) : (
        <Painel>
          <p className="px-4 py-6 text-sm text-fg-mute">Só quem ocupa posição em Gente &amp; Gestão (ou o admin) importa membros. Para incluir alguém, fale com a área G&amp;G.</p>
        </Painel>
      )}
    </div>
  );
}
