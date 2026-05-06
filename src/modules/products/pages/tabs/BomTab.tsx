import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

export function BomTab({ productId }: { productId: string }) {
  const [boms, setBoms] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("boms").select("*").eq("product_id", productId).order("created_at", { ascending: false });
      setBoms(data ?? []);
    })();
  }, [productId]);

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="font-semibold">Listas de materiais (BOM/Kit)</div>
        <Button size="sm" asChild><Link to={`/products/bom/new?product=${productId}`}><Plus className="h-4 w-4 mr-1" />Nova BOM</Link></Button>
      </div>
      <table className="w-full text-sm border">
        <thead className="bg-muted/40">
          <tr><th className="text-left p-2">Código</th><th className="text-left p-2">Tipo</th><th className="text-left p-2 w-28">Qtd</th><th className="text-left p-2 w-24">Ativo</th></tr>
        </thead>
        <tbody>
          {boms.length === 0 ? (
            <tr><td colSpan={4} className="text-center text-muted-foreground py-6">Sem BOMs. Crie uma do tipo <b>phantom</b> para vender como kit.</td></tr>
          ) : boms.map((b) => (
            <tr key={b.id} className="border-t hover:bg-muted/40">
              <td className="p-2"><Link to={`/products/bom/${b.id}`} className="text-primary hover:underline">{b.code || b.id.slice(0, 8)}</Link></td>
              <td className="p-2"><Badge variant={b.type === "phantom" ? "default" : "secondary"}>{b.type}</Badge></td>
              <td className="p-2">{b.quantity}</td>
              <td className="p-2">{b.active ? "Sim" : "Não"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-muted-foreground">
        <b>Phantom (Kit):</b> ao vender, o sistema entrega os componentes em vez do produto pai.
        <b className="ml-2">Normal:</b> usado para fabrico futuro.
      </div>
    </div>
  );
}
