import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export function StockTab({ productId }: { productId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [whId, setWhId] = useState<string>("");
  const [qty, setQty] = useState<string>("0");
  const [reason, setReason] = useState<string>("");

  const load = async () => {
    const { data } = await supabase
      .from("product_stock_forecast")
      .select("*, warehouses(name,code)")
      .eq("product_id", productId);
    setRows(data ?? []);
  };

  useEffect(() => {
    load();
    supabase.from("warehouses").select("id,name").eq("active", true).order("name").then(({ data }) => {
      setWarehouses(data ?? []);
      if (data?.[0]) setWhId(data[0].id);
    });
  }, [productId]);

  const setStock = async () => {
    if (!whId) return toast.error("Selecione um armazém");
    const { error } = await supabase.rpc("set_product_stock", {
      _product: productId, _warehouse: whId, _qty: Number(qty), _reason: reason || "Ajuste manual",
    });
    if (error) return toast.error(error.message);
    toast.success("Stock atualizado");
    setReason(""); await load();
  };

  const tot = rows.reduce((acc, r) => ({
    on_hand: acc.on_hand + Number(r.on_hand || 0),
    available: acc.available + Number(r.available || 0),
    forecasted: acc.forecasted + Number(r.forecasted || 0),
    sold_30d: acc.sold_30d + Number(r.sold_30d || 0),
  }), { on_hand: 0, available: 0, forecasted: 0, sold_30d: 0 });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Em mão</div><div className="text-2xl font-semibold">{fmtNumber(tot.on_hand)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Disponível</div><div className="text-2xl font-semibold">{fmtNumber(tot.available)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Previsto</div><div className="text-2xl font-semibold text-primary">{fmtNumber(tot.forecasted)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Vendido 30d</div><div className="text-2xl font-semibold">{fmtNumber(tot.sold_30d)}</div></Card>
      </div>

      <Card className="p-4 space-y-3">
        <div className="font-semibold text-sm">Definir stock</div>
        <div className="grid sm:grid-cols-[1fr_120px_1fr_auto] gap-2 items-end">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Armazém</div>
            <Select value={whId} onValueChange={setWhId}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Quantidade</div>
            <Input className="h-9" type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Motivo (opcional)</div>
            <Input className="h-9" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Inventário inicial, recebimento manual…" />
          </div>
          <Button onClick={setStock}>Aplicar</Button>
        </div>
      </Card>

      <table className="w-full text-sm border">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left p-2">Armazém</th>
            <th className="text-right p-2">Em mão</th>
            <th className="text-right p-2">Reservado</th>
            <th className="text-right p-2">Disponível</th>
            <th className="text-right p-2">A receber</th>
            <th className="text-right p-2">A entregar</th>
            <th className="text-right p-2">Previsto</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Sem dados</td></tr>
            : rows.map((r) => (
              <tr key={r.warehouse_id} className="border-t">
                <td className="p-2">{r.warehouses?.name || r.warehouse_id?.slice(0, 8)}</td>
                <td className="p-2 text-right">{fmtNumber(r.on_hand)}</td>
                <td className="p-2 text-right">{fmtNumber(r.reserved)}</td>
                <td className="p-2 text-right">{fmtNumber(r.available)}</td>
                <td className="p-2 text-right text-emerald-600">+{fmtNumber(r.incoming)}</td>
                <td className="p-2 text-right text-rose-600">−{fmtNumber(r.outgoing)}</td>
                <td className="p-2 text-right font-semibold">{fmtNumber(r.forecasted)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
