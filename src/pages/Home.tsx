import { Link } from "react-router-dom";
import { useInstalledModules } from "@/core/modules/useInstalledModules";
import { MODULES } from "@/core/modules/registry";
import { cn } from "@/lib/utils";

export default function Home() {
  const installed = useInstalledModules();
  const visible = MODULES.filter((m) => m.id === "settings" || installed.data?.[m.id as string]);
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Bem-vindo ao UP Móveis ERP</h1>
        <p className="text-muted-foreground mt-1">Escolha um aplicativo para começar.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {visible.map((m) => (
          <Link
            key={m.id}
            to={m.basePath}
            className="group flex flex-col items-center gap-3 p-6 rounded-xl border bg-card hover:shadow-elegant transition-all hover:-translate-y-0.5"
          >
            <div className={cn("h-14 w-14 rounded-xl grid place-items-center text-white", m.color)}>
              <m.icon className="h-7 w-7" />
            </div>
            <div className="text-center">
              <div className="font-semibold">{m.name}</div>
              <div className="text-xs text-muted-foreground mt-1">{m.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
