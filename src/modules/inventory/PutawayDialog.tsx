import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PackagePlus } from "lucide-react";

type Props = {
  trigger?: React.ReactNode;
  /** Lock the product (used from product page). */
  productId?: string;
  productName?: string;
  /** Lock the location (used from a bin row). */
  locationId?: string;
  locationLabel?: string;
  onDone?: () => void;
};

type LocOpt = { id: string; full_path: string | null; name: string };
type ProdOpt = { id: string; name: string };
type PkgOpt = { id: string; label: string };

export default function PutawayDialog({ trigger, productId, productName, locationId, locationLabel, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [productOpts, setProductOpts] = useState<ProdOpt[]>([]);
  const [locationOpts, setLocationOpts] = useState<LocOpt[]>([]);
  const [packages, setPackages] = useState<PkgOpt[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>(productId ?? "");
  const [selectedLocation, setSelectedLocation] = useState<string>(locationId ?? "");
  const [selectedPackage, setSelectedPackage] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!productId) {
      supabase.from("products").select("id,name").eq("active", true).order("name").limit(500)
        .then(({ data }) => setProductOpts((data ?? []) as ProdOpt[]));
    }
    if (!locationId) {
      supabase.from("stock_locations")
        .select("id,name,full_path")
        .eq("type", "internal").eq("is_bin", true).eq("active", true)
        .order("full_path")
        .then(({ data }) => setLocationOpts((data ?? []) as LocOpt[]));
    }
  }, [open, productId, locationId]);

  useEffect(() => {
    if (!selectedProduct) { setPackages([]); setSelectedPackage(""); return; }
    supabase.from("product_packages").select("id,label").eq("product_id", selectedProduct).order("sequence")
      .then(({ data }) => setPackages((data ?? []) as PkgOpt[]));
    setSelectedPackage("");
  }, [selectedProduct]);

  const submit = async () => {
    if (!selectedProduct) return toast.error("Escolha um produto");
    if (!selectedLocation) return toast.error("Escolha uma localização");
    if (!qty || qty <= 0) return toast.error("Quantidade inválida");
    setBusy(true);
    const { error } = await supabase.rpc("putaway_stock", {
      _product: selectedProduct,
      _package: selectedPackage || null,
      _qty: qty,
      _location: selectedLocation,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Stock arrumado");
    setOpen(false);
    setQty(1); setSelectedPackage("");
    if (!productId) setSelectedProduct("");
    if (!locationId) setSelectedLocation("");
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <PackagePlus className="h-4 w-4" /> Arrumar em local
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arrumar produto numa localização</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Produto</Label>
            {productId ? (
              <div className="px-3 py-2 rounded border bg-muted text-sm">{productName ?? productId}</div>
            ) : (
              <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                <SelectTrigger><SelectValue placeholder="Escolher produto…" /></SelectTrigger>
                <SelectContent>
                  {productOpts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {packages.length > 0 && (
            <div>
              <Label>Colis (opcional)</Label>
              <Select value={selectedPackage || "__none__"} onValueChange={(v) => setSelectedPackage(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Sem colis específico" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem colis específico</SelectItem>
                  {packages.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Localização (bin)</Label>
            {locationId ? (
              <div className="px-3 py-2 rounded border bg-muted text-sm font-mono">{locationLabel ?? locationId}</div>
            ) : (
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger><SelectValue placeholder="Escolher bin…" /></SelectTrigger>
                <SelectContent>
                  {locationOpts.map((l) => <SelectItem key={l.id} value={l.id}>{l.full_path ?? l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Quantidade</Label>
            <Input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "A arrumar…" : "Arrumar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
