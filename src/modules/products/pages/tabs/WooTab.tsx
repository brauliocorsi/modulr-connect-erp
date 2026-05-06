import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export function WooTab({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch checked={!!form.published_woo} onCheckedChange={(v) => setForm({ ...form, published_woo: v })} />
        <Label>Publicar no WooCommerce</Label>
        {form.woo_product_id && <Badge variant="secondary">Woo #{form.woo_product_id}</Badge>}
        {form.woo_sync_status && <Badge>{form.woo_sync_status}</Badge>}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Slug</Label>
          <Input value={form.woo_slug ?? ""} onChange={(e) => setForm({ ...form, woo_slug: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Estado Woo</Label>
          <select className="h-10 w-full border rounded px-3 bg-background" value={form.woo_status ?? "draft"} onChange={(e) => setForm({ ...form, woo_status: e.target.value })}>
            <option value="draft">Rascunho</option>
            <option value="publish">Publicado</option>
            <option value="private">Privado</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Descrição curta (Woo)</Label>
        <Textarea rows={3} value={form.short_description ?? ""} onChange={(e) => setForm({ ...form, short_description: e.target.value })} />
      </div>
      <div className="text-xs text-muted-foreground border-l-2 border-primary pl-3">
        Sincronização ativa quando configurar URL e chaves da loja Woo nas Definições. Por agora os dados ficam guardados e prontos a enviar.
      </div>
    </div>
  );
}
