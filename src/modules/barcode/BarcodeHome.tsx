import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Layers, Waves, Package, MapPin, ClipboardCheck } from "lucide-react";

const TILES = [
  { to: "/barcode/op/incoming", label: "Receção", desc: "Entradas de produtos", icon: ArrowDownToLine, color: "from-emerald-500 to-emerald-700" },
  { to: "/barcode/op/outgoing", label: "Expedição", desc: "Envios para clientes", icon: ArrowUpFromLine, color: "from-sky-500 to-sky-700" },
  { to: "/barcode/op/internal", label: "Transferência interna", desc: "Movimentos entre locais", icon: ArrowLeftRight, color: "from-indigo-500 to-indigo-700" },
  { to: "/barcode/op/all", label: "Picking", desc: "Qualquer transferência", icon: ClipboardCheck, color: "from-violet-500 to-violet-700" },
  { to: "/barcode/batches", label: "Lote (Batch)", desc: "Várias transferências", icon: Layers, color: "from-amber-500 to-amber-700" },
  { to: "/barcode/waves", label: "Onda (Wave)", desc: "Movimentos agrupados", icon: Waves, color: "from-cyan-500 to-cyan-700" },
  { to: "/barcode/lookup/product", label: "Consultar produto", desc: "Stock e localizações", icon: Package, color: "from-rose-500 to-rose-700" },
  { to: "/barcode/lookup/location", label: "Consultar local", desc: "Quants no local", icon: MapPin, color: "from-fuchsia-500 to-fuchsia-700" },
];

export default function BarcodeHome() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-1">Operações de armazém</h1>
      <p className="text-slate-400 mb-8">Selecione uma operação. Toda a aplicação foi desenhada para uso 100% via leitor de códigos.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
    </div>
  );
}
