import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { Package, ShoppingCart, Users, Warehouse, ShoppingBag } from "lucide-react";

type Hit = { type: string; id: string; label: string; sub?: string; to: string };

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const nav = useNavigate();

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const ilike = `%${q}%`;
      const [{ data: prods }, { data: parts }, { data: sos }, { data: pos }, { data: pks }] = await Promise.all([
        supabase.from("products").select("id, name, internal_ref").ilike("name", ilike).limit(5),
        supabase.from("partners").select("id, name, email").ilike("name", ilike).limit(5),
        supabase.from("sale_orders").select("id, name, partner_id, partners(name)").ilike("name", ilike).limit(5),
        supabase.from("purchase_orders").select("id, name, partner_id, partners(name)").ilike("name", ilike).limit(5),
        supabase.from("stock_pickings").select("id, name, kind").ilike("name", ilike).limit(5),
      ]);
      const out: Hit[] = [];
      (prods ?? []).forEach((p: any) => out.push({ type: "Produto", id: p.id, label: p.name, sub: p.internal_ref ?? "", to: `/products` }));
      (parts ?? []).forEach((p: any) => out.push({ type: "Parceiro", id: p.id, label: p.name, sub: p.email ?? "", to: `/sales/customers` }));
      (sos ?? []).forEach((s: any) => out.push({ type: "Venda", id: s.id, label: s.name, sub: s.partners?.name ?? "", to: `/sales/orders` }));
      (pos ?? []).forEach((s: any) => out.push({ type: "Compra", id: s.id, label: s.name, sub: s.partners?.name ?? "", to: `/purchase/orders` }));
      (pks ?? []).forEach((p: any) => out.push({ type: "Transferência", id: p.id, label: p.name, sub: p.kind, to: `/inventory/transfers` }));
      setHits(out);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const iconFor = (t: string) =>
    t === "Produto" ? Package : t === "Parceiro" ? Users : t === "Venda" ? ShoppingCart : t === "Compra" ? ShoppingBag : Warehouse;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar em todos os módulos…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>{q ? "Nenhum resultado" : "Comece a digitar para buscar"}</CommandEmpty>
        {hits.length > 0 && (
          <CommandGroup heading="Resultados">
            {hits.map((h) => {
              const Icon = iconFor(h.type);
              return (
                <CommandItem
                  key={h.type + h.id}
                  onSelect={() => {
                    nav(h.to);
                    onOpenChange(false);
                  }}
                >
                  <Icon className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span className="flex-1">{h.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">{h.type}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
