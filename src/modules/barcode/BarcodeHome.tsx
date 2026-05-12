import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Layers, Waves, Package, MapPin, ClipboardCheck, Printer, PackagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { printCommandBarcodes, printLocationBarcodes } from "./printBarcodes";

const TILES = [
  { to: "/barcode/op/incoming", label: "Receção", desc: "Entradas de produtos", icon: ArrowDownToLine, color: "from-emerald-500 to-emerald-700" },
  { to: "/barcode/op/outgoing", label: "Expedição", desc: "Envios para clientes", icon: ArrowUpFromLine, color: "from-sky-500 to-sky-700" },
  { to: "/barcode/op/internal", label: "Transferência interna", desc: "Movimentos entre locais", icon: ArrowLeftRight, color: "from-indigo-500 to-indigo-700" },
  { to: "/barcode/op/all", label: "Picking", desc: "Qualquer transferência", icon: ClipboardCheck, color: "from-violet-500 to-violet-700" },
  { to: "/barcode/putaway", label: "Arrumar", desc: "Colis/produto → bin", icon: PackagePlus, color: "from-orange-500 to-orange-700" },
  { to: "/barcode/batches", label: "Lote (Batch)", desc: "Várias transferências", icon: Layers, color: "from-amber-500 to-amber-700" },
  { to: "/barcode/waves", label: "Onda (Wave)", desc: "Movimentos agrupados", icon: Waves, color: "from-cyan-500 to-cyan-700" },
  { to: "/barcode/lookup/product", label: "Consultar produto", desc: "Stock e localizações", icon: Package, color: "from-rose-500 to-rose-700" },
  { to: "/barcode/lookup/location", label: "Consultar local", desc: "Quants no local", icon: MapPin, color: "from-fuchsia-500 to-fuchsia-700" },
];

export default function BarcodeHome() {
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [whId, setWhId] = useState<string>("");

  useEffect(() => {
    supabase.from("warehouses").select("id,name").eq("active", true).order("name").then(({ data }) => {
      setWarehouses(data ?? []);
    });
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-1">Operações de armazém</h1>
      <p className="text-slate-400 mb-8">Selecione uma operação. Toda a aplicação foi desenhada para uso 100% via leitor de códigos.</p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {TILES.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`group relative overflow-hidden rounded-xl bg-gradient-to-br ${t.color} p-6 text-white shadow-lg hover:scale-[1.02] active:scale-[0.99] transition-transform`}
            >
              <Icon className="h-10 w-10 mb-3 opacity-90" />
              <div className="text-xl font-bold">{t.label}</div>
              <div className="text-sm opacity-80">{t.desc}</div>
            </Link>
          );
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Printer className="h-5 w-5 text-slate-300" />
          <h2 className="text-lg font-semibold">Impressão para o posto</h2>
        </div>
        <p className="text-slate-400 text-sm mb-4">
          Imprima cartas com códigos de barras para comandos do leitor (OK, ESC, menus) e para todos os locais do armazém. Cole na prateleira ou no posto de trabalho.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-800 p-4 bg-slate-950/40">
            <div className="font-semibold mb-1">Comandos do leitor</div>
            <div className="text-xs text-slate-400 mb-3">OK, ESC, menus de operação e atalhos.</div>
            <button
              onClick={() => printCommandBarcodes()}
              className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold inline-flex items-center gap-2"
            >
              <Printer className="h-4 w-4" /> Imprimir comandos
            </button>
          </div>
          <div className="rounded-lg border border-slate-800 p-4 bg-slate-950/40">
            <div className="font-semibold mb-1">Locais do armazém</div>
            <div className="text-xs text-slate-400 mb-3">Códigos de todas as posições internas.</div>
            <div className="flex flex-wrap gap-2">
              <select
                value={whId}
                onChange={(e) => setWhId(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-2 text-sm text-white"
              >
                <option value="">Todos os armazéns</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <button
                onClick={() => printLocationBarcodes({ warehouseId: whId || undefined })}
                className="px-3 py-2 rounded bg-sky-600 hover:bg-sky-500 text-sm font-semibold inline-flex items-center gap-2"
              >
                <Printer className="h-4 w-4" /> Imprimir locais
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
