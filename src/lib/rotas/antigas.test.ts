import nextConfig from "../../../next.config";
import { REDIRECTS_ROTAS_ANTIGAS } from "./antigas";
import { NAV_ITEMS } from "@/components/shell/nav-config";

describe("rotas antigas do card (GAB-80)", () => {
  it("/kanban/:id e /oportunidades/:id levam a /projetos/:id; o quadro /kanban fica onde está", () => {
    const destinos = Object.fromEntries(REDIRECTS_ROTAS_ANTIGAS.map((r) => [r.source, r.destination]));
    expect(destinos["/kanban/:id"]).toBe("/projetos/:id");
    expect(destinos["/oportunidades/:id"]).toBe("/projetos/:id");
    expect(destinos["/kanban"]).toBeUndefined();
  });

  it("/projetos sem id abre o quadro Projetos, o mesmo destino do item da navegação", () => {
    const r = REDIRECTS_ROTAS_ANTIGAS.find((x) => x.source === "/projetos");
    expect(r?.destination).toBe("/kanban?quadro=projetos");
    expect(r?.destination).toBe(NAV_ITEMS.find((i) => i.quadro === "projetos")?.href);
  });

  it("o next.config publica os redirects", async () => {
    expect(await nextConfig.redirects?.()).toEqual(REDIRECTS_ROTAS_ANTIGAS);
  });
});
