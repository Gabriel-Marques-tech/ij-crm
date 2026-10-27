import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { ImportarPipefy } from "./importar-pipefy";

export const metadata = { title: "Importar" };

export default async function ImportarPage() {
  await exigirPapel("GESTOR");
  return (
    <>
      <PageHeader
        eyebrow="gestão · importar"
        title="Importar do Pipefy"
        description="Envie o CSV exportado do pipe. Você vê a prévia (cards por fase, responsáveis sem usuário, linhas com erro) e só depois confirma. Importar de novo o mesmo arquivo atualiza os cards, não duplica."
      />
      <ImportarPipefy />
    </>
  );
}
