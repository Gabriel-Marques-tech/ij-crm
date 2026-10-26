import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Busca da lista via querystring (`?q=`): funciona sem JS e o link é compartilhável. */
export function FormBusca({ valor, placeholder, rotulo }: { valor: string; placeholder: string; rotulo: string }) {
  return (
    <form role="search" method="get" className="mb-4 flex max-w-xl gap-2">
      <label htmlFor="busca-lista" className="sr-only">
        {rotulo}
      </label>
      <Input id="busca-lista" name="q" type="search" defaultValue={valor} maxLength={200} placeholder={placeholder} />
      <Button type="submit" variant="outline">
        <Search className="size-4" aria-hidden /> Buscar
      </Button>
    </form>
  );
}
