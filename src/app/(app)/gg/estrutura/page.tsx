import { redirect } from "next/navigation";

/** GAB-106: áreas, frentes, cargos e posições foram para junto de Membros. */
export default function EstruturaAntiga() {
  redirect("/membros/estrutura");
}
