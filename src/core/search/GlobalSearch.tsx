import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { Package, ShoppingCart, Users, Warehouse, ShoppingBag, Truck, LayoutGrid } from "lucide-react";
import { MODULES } from "@/core/modules/registry";
import { useInstalledModules } from "@/core/modules/useInstalledModules";

type Hit = { type: string; id: string; label: string; sub?: string; to: string; icon: any };

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const ilike = `%${term}%`;
      const [prods, parts, sos, pos, pks] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, internal_ref")
          .or(`name.ilike.${ilike},internal_ref.ilike.${ilike}`)
          .limit(6),
        supabase
          .from("partners")
          .select("id, name, email, tax_id, is_customer, is_supplier")
          .or(`name.ilike.${ilike},email.ilike.${ilike},tax_id.ilike.${ilike}`)
          .limit(6),
        supabase
          .from("sale_orders")
          .select("id, name, partners(name)")
          .ilike("name", ilike)
          .limit(5),
        supabase
          .from("purchase_orders")
          .select("id, name, partners(name)")
          .ilike("name", ilike)
          .limit(5),
        supabase
          .from("stock_pickings")
          .select("id, name, kind")
          .ilike("name", ilike)
          .limit(5),
      ]);

      const out: Hit[] = [];
      (prods.data ?? []).forEach((p: any) =>
        out.push({ type: "Produto", id: p.id, label: p.name, sub: p.internal_ref ?? "", to: `/products/${p.id}`, icon: Package })
      );
      (parts.data ?? []).forEach((p: any) => {
        const path = p.is_supplier && !p.is_customer ? `/purchase/suppliers/${p.id}` : `/sales/customers/${p.id}`;
        out.push({ type: "Parceiro", id: p.id, label: p.name, sub: p.email ?? p.tax_id ?? "", to: path, icon: Users });
      });
      (sos.data ?? []).forEach((s: any) =>
        out.push({ type: "Venda", id: s.id, label: s.name, sub: s.partners?.name ?? "", to: `/sales/orders/${s.id}`, icon: ShoppingCart })
      );
      (pos.data ?? []).forEach((s: any) =>
        out.push({ type: "Compra", id: s.id, label: s.name, sub: s.partners?.name ?? "", to: `/purchase/orders/${s.id}`, icon: ShoppingBag })
      );
      (pks.data ?? []).forEach((p: any) =>
        out.push({ type: "Transferência", id: p.id, label: p.name, sub: p.kind ?? "", to: `/inventory/transfers/${p.id}`, icon: Truck })
      );

      setHits(out);
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const grouped = hits.reduce<Record<string, Hit[]>>((acc, h) => {
    (acc[h.type] ??= []).push(h);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar produtos, parceiros, pedidos, compras, transferências…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>{loading ? "Buscando…" : q ? "Nenhum resultado" : "Comece a digitar para buscar"}</CommandEmpty>
        {Object.entries(grouped).map(([type, items], i) => (
          <div key={type}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={type}>
              {items.map((h) => {
                const Icon = h.icon;
                return (
                  <CommandItem
                    key={h.type + h.id}
                    value={`${h.type}-${h.label}-${h.id}`}
                    onSelect={() => {
                      nav(h.to);
                      onOpenChange(false);
                    }}
                  >
                    <Icon className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span className="flex-1">{h.label}</span>
                    {h.sub && <span className="text-xs text-muted-foreground ml-2">{h.sub}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
