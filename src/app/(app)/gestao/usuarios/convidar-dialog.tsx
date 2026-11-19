"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import type { Papel } from "@prisma/client";
import { Copy, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AreaPosicoes, FichaLigada, OpcaoPosicao } from "@/lib/auth/cadastro";
import { descreverConta } from "@/lib/gg/modelo";
import { criarConviteAction } from "./actions";
import { CampoPosicao, localizarPosicao } from "./campo-posicao";

type Posicoes = { areas: readonly AreaPosicoes[]; temAreaGG: boolean };
const SEM_POSICOES: Posicoes = { areas: [], temAreaGG: false };

/**
 * Formulário único de cadastro (GAB-105), usado na Gestão → Usuários e na página Membros (GAB-106).
 * Sem `aberto`, o diálogo tem o próprio botão e estado. Com `aberto`/`onAbertoChange`, quem chama
 * controla (o organograma abre pelo cargo vago, com `posicaoInicial`).
 */
export function ConvidarDialog({
  papelAtor,
  googleAtivo = false,
  posicoes = SEM_POSICOES,
  posicaoInicial = null,
  aberto: abertoControlado,
  onAbertoChange,
  rotuloGatilho,
}: {
  papelAtor: Papel;
  googleAtivo?: boolean;
  posicoes?: Posicoes;
  posicaoInicial?: string | null;
  aberto?: boolean;
  onAbertoChange?: (aberto: boolean) => void;
  rotuloGatilho?: string;
}) {
  const [abertoProprio, setAbertoProprio] = useState(false);
  const aberto = abertoControlado ?? abertoProprio;
  // Remonta o corpo a cada abertura: o estado do useActionState (link gerado,
  // erro) não vaza para o próximo convite.
  const [iteracao, setIteracao] = useState(0);

  function mudarAberto(v: boolean) {
    setAbertoProprio(v);
    onAbertoChange?.(v);
    if (!v) setIteracao((i) => i + 1);
  }

  return (
    <Dialog open={aberto} onOpenChange={mudarAberto}>
      <DialogTrigger render={<Button />}>
        <UserPlus className="h-4 w-4" />
        {rotuloGatilho ?? (googleAtivo ? "Cadastrar" : "Convidar")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{googleAtivo ? "Cadastrar pessoa" : "Convidar pessoa"}</DialogTitle>
          <DialogDescription>
            {googleAtivo
              ? "Depois de salvar, a pessoa já entra com a conta Google deste email. Não precisa mandar link."
              : "Você recebe um link para mandar por WhatsApp ou email. Vale 7 dias."}
          </DialogDescription>
        </DialogHeader>
        <CorpoConvite key={`${iteracao}-${posicaoInicial ?? ""}`} papelAtor={papelAtor} googleAtivo={googleAtivo} posicoes={posicoes} posicaoInicial={posicaoInicial} onFechar={() => mudarAberto(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Prévia da conta (GAB-107): o que a posição dá no CRM, numa linha. Sem posição, Visualizador.
 * Mesmo cálculo do servidor (`contaDaDerivacao`), que é quem grava; aqui é só para quem cadastra ver.
 */
function previaDaConta(o: OpcaoPosicao | null, administrador: boolean): string {
  const s = o?.sugestao ?? { papel: "VISUALIZADOR" as const, area: null, cargos: [] };
  return descreverConta(administrador ? { ...s, papel: "ADMIN" } : s);
}

export function CorpoConvite({
  papelAtor,
  googleAtivo,
  posicoes = SEM_POSICOES,
  posicaoInicial = null,
  onFechar,
}: {
  papelAtor: Papel;
  googleAtivo: boolean;
  posicoes?: Posicoes;
  posicaoInicial?: string | null;
  onFechar: () => void;
}) {
  const [estado, action, pendente] = useActionState(criarConviteAction, undefined);
  // Envio por onSubmit (não `<form action>`): o React não limpa o form depois da action, então o que a
  // tela mostra (cascata, administrador) é sempre o que vai no próximo envio, inclusive na confirmação.
  const formRef = useRef<HTMLFormElement>(null);
  // GAB-107: papel, área e cargos saem da posição (no servidor). A tela só mostra a prévia.
  // Aberto por um cargo vago (GAB-106): a posição já vem na cascata.
  const [posicao, setPosicao] = useState<OpcaoPosicao | null>(() => localizarPosicao(posicoes.areas, posicaoInicial)?.opcao ?? null);
  const [administrador, setAdministrador] = useState(false);
  const podeDarAdmin = papelAtor === "ADMIN";

  function enviar(extra?: [campo: "ligarMembroId" | "criarMembroNovo", valor: string]) {
    const form = formRef.current;
    if (!form) return;
    // A confirmação do homônimo vale para os dados que estão no form agora, que o navegador valida de novo.
    if (extra && !form.reportValidity()) return;
    const f = new FormData(form);
    if (extra) f.set(extra[0], extra[1]);
    startTransition(() => action(f));
  }

  if (estado?.link && googleAtivo) return <CadastroComGoogle email={estado.email} link={estado.link} expiraEm={estado.expiraEm} fichaLigada={estado.fichaLigada} onFechar={onFechar} />;
  if (estado?.link)
    return (
      <div className="space-y-4">
        {estado.fichaLigada ? <NotaFichaLigada ficha={estado.fichaLigada} /> : null}
        <LinkGerado link={estado.link} expiraEm={estado.expiraEm} onFechar={onFechar} />
      </div>
    );

  const homonimos = estado?.homonimos ?? [];
  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        enviar();
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" name="nome" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="telefone">WhatsApp (DDD + número)</Label>
        <Input id="telefone" name="telefone" placeholder="11 99999-8888" inputMode="tel" />
      </div>
      <CampoPosicao areas={posicoes.areas} temAreaGG={posicoes.temAreaGG} onEscolher={setPosicao} posicaoInicial={posicaoInicial} />
      <p className="-mt-2 text-xs text-fg-faint" aria-live="polite">
        Conta no CRM: {previaDaConta(posicao, administrador)}
      </p>
      {podeDarAdmin ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="administrador" value="1" checked={administrador} onChange={(e) => setAdministrador(e.currentTarget.checked)} />
          Administrador
        </label>
      ) : null}
      {homonimos.length ? (
        <div role="alert" className="space-y-2 rounded-lg border border-warn/50 bg-muted p-3 text-sm">
          <p>
            {homonimos.length === 1 ? (
              <>
                Já existe <strong>&quot;{homonimos[0].nome}&quot;</strong> sem e-mail no G&G. Ligar a ele?
              </>
            ) : (
              <>Há {homonimos.length} membros sem e-mail no G&G com esse nome. É algum deles?</>
            )}
          </p>
          <p className="text-xs text-fg-faint">Ligar grava este e-mail na ficha e registra no histórico. Se for outra pessoa, um membro novo é criado.</p>
          <div className="flex flex-wrap gap-2">
            {homonimos.map((h, i) => (
              <Button key={h.id} type="button" size="sm" disabled={pendente} onClick={() => enviar(["ligarMembroId", h.id])}>
                {homonimos.length === 1 ? "Ligar a ele e salvar" : `Ligar a "${h.nome}" (${i + 1})`}
              </Button>
            ))}
            <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={() => enviar(["criarMembroNovo", "1"])}>
              É outra pessoa: criar membro novo
            </Button>
          </div>
        </div>
      ) : estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Salvando…" : googleAtivo ? "Cadastrar" : "Gerar link de convite"}
      </Button>
    </form>
  );
}

/** Ficha do G&G que já existia e foi ligada à conta (GAB-105), com as posições abertas dela. */
function NotaFichaLigada({ ficha }: { ficha: FichaLigada }) {
  return (
    <p className="rounded-lg border border-border bg-muted p-3 text-sm">
      Ficha existente no G&G ligada: <strong>{ficha.nome}</strong>. Posições: {ficha.posicoes.length ? ficha.posicoes.join(", ") : "nenhuma"}.
    </p>
  );
}

function CadastroComGoogle({ email, link, expiraEm, fichaLigada, onFechar }: { email?: string; link: string; expiraEm?: string; fichaLigada?: FichaLigada; onFechar: () => void }) {
  const [mostrarLink, setMostrarLink] = useState(false);
  if (mostrarLink) return <LinkGerado link={link} expiraEm={expiraEm} onFechar={onFechar} aviso="Mostrado só uma vez. Deixa de valer depois do primeiro login com Google." />;
  return (
    <div className="space-y-4">
      {fichaLigada ? <NotaFichaLigada ficha={fichaLigada} /> : null}
      <div className="rounded-lg border border-border bg-muted p-3 text-sm">
        <p className="eyebrow mb-1">cadastrado</p>
        <p>
          {email ? <span className="font-mono text-fg-soft">{email}</span> : "A pessoa"} já pode entrar no CRM com <strong>Entrar com Google</strong>. Não precisa mandar link.
        </p>
      </div>
      <p className="text-xs text-fg-faint">
        Prefere que ela use senha? Mostre o link de convite (vale 7 dias, aparece uma vez só). Ele deixa de valer depois do primeiro login com Google.
      </p>
      <div className="flex gap-2">
        <Button onClick={onFechar} className="flex-1">
          Fechar
        </Button>
        <Button variant="outline" onClick={() => setMostrarLink(true)}>
          Mostrar link de convite
        </Button>
      </div>
    </div>
  );
}

export function LinkGerado({
  link,
  expiraEm,
  onFechar,
  rotulo = "link do convite",
  aviso = "Mostrado só uma vez — se perder, reemita.",
}: {
  link: string;
  expiraEm?: string;
  onFechar: () => void;
  rotulo?: string;
  aviso?: string;
}) {
  const [copiado, setCopiado] = useState<"nao" | "sim" | "manual">("nao");
  const campo = useRef<HTMLInputElement>(null);

  async function copiar() {
    // navigator.clipboard só existe em origem segura (HTTPS/localhost). Fora
    // disso, seleciona o texto para o usuário copiar com Ctrl+C.
    try {
      if (!navigator.clipboard?.writeText) throw new Error("sem clipboard");
      await navigator.clipboard.writeText(link);
      setCopiado("sim");
    } catch {
      campo.current?.focus();
      campo.current?.select();
      setCopiado("manual");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-3">
        <p className="eyebrow mb-1">{rotulo}</p>
        <input
          ref={campo}
          readOnly
          value={link}
          aria-label={rotulo}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full bg-transparent font-mono text-xs text-fg-soft outline-none"
        />
      </div>
      {expiraEm ? (
        <p className="text-xs text-fg-faint">
          Expira em{" "}
          <span className="font-mono">
            {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(expiraEm))}
          </span>
          . {aviso}
        </p>
      ) : null}
      {copiado === "manual" ? <p className="text-xs text-warn">Não deu pra copiar automaticamente: o link está selecionado, use Ctrl+C.</p> : null}
      <div className="flex gap-2">
        <Button onClick={copiar} className="flex-1">
          <Copy className="h-4 w-4" />
          {copiado === "sim" ? "Copiado" : "Copiar link"}
        </Button>
        <Button variant="outline" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    </div>
  );
}
