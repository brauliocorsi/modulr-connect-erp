import { Link } from "react-router-dom";
import { useInstalledModules } from "@/core/modules/useInstalledModules";
import { MODULES } from "@/core/modules/registry";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/lib/utils";

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Comercial", ids: ["sales"] },
  { title: "Produtos & Engenharia", ids: ["products"] },
  { title: "Compras", ids: ["purchase"] },
  { title: "Produção", ids: ["manufacturing", "shop_floor"] },
  { title: "Inventário & Logística", ids: ["inventory", "routes", "delivery", "barcode"] },
  { title: "Financeiro", ids: ["finance", "cashbox"] },
  { title: "Atendimento", ids: ["service", "helpdesk", "discuss"] },
  { title: "Sistema", ids: ["hr", "settings"] },
];

export default function Home() {
  const { user } = useAuth();
  const installed = useInstalledModules();
  const ALWAYS_ON = new Set(["settings", "hr", "discuss", "finance", "cashbox", "service", "helpdesk"]);
  const visible = MODULES.filter((m) => ALWAYS_ON.has(m.id as string) || installed.data?.[m.id as string]);

  const grouped = GROUPS.map((g) => ({
    ...g,
    modules: g.ids
      .map((id) => visible.find((m) => (m.id as string) === id))
      .filter(Boolean) as typeof visible,
  })).filter((g) => g.modules.length > 0);
  const assignedIds = new Set(GROUPS.flatMap((g) => g.ids));
  const others = visible.filter((m) => !assignedIds.has(m.id as string));
  if (others.length) grouped.push({ title: "Outros", ids: [], modules: others });

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 19) return "Boa tarde";
    return "Boa noite";
  })();
  const name = user?.email?.split("@")[0] ?? "";

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto space-y-10">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">{greeting}{name && `, ${name}`} 👋</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Escolha uma aplicação ou pressione <kbd className="border rounded px-1.5 py-0.5 text-[10px] bg-muted">Ctrl</kbd> + <kbd className="border rounded px-1.5 py-0.5 text-[10px] bg-muted">K</kbd> para buscar.
          </p>
        </div>
      </header>

      {grouped.map((g) => (
        <section key={g.title}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {g.title}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {g.modules.map((m) => (
              <Link
                key={m.id}
                to={m.basePath}
                className="group flex items-center gap-3 p-4 rounded-xl border bg-card hover:shadow-elegant transition-all hover:-translate-y-0.5"
              >
                <div className={cn("h-11 w-11 shrink-0 rounded-lg grid place-items-center text-white", m.color)}>
                  <m.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{m.name}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2">{m.description}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
