import { NavLink, useLocation } from "react-router-dom";
import { MODULES, getModuleByPath, type ModuleMenuItem } from "@/core/modules/registry";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

function groupBySection(items: ModuleMenuItem[]) {
  const groups = new Map<string, ModuleMenuItem[]>();
  for (const it of items) {
    const k = it.section ?? "Geral";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  return Array.from(groups.entries());
}

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(to + "/");
}

export default function ModuleInnerMenu() {
  const { pathname } = useLocation();
  const mod = getModuleByPath(pathname);
  if (!mod) return null;
  // Re-resolve from MODULES registry to ensure freshness
  const def = MODULES.find((m) => m.id === mod.id) ?? mod;
  if (!def.menu || def.menu.length === 0) return null;

  const sections = groupBySection(def.menu);

  return (
    <nav
      data-testid="module-inner-menu"
      data-module={String(def.id)}
      aria-label={`Menu de ${def.name}`}
      className="border-b bg-card/40 px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
    >
      <div className="font-semibold text-muted-foreground mr-2 flex items-center gap-1.5">
        <def.icon className="h-3.5 w-3.5" />
        <span>{def.name}</span>
      </div>
      {sections.map(([section, items]) => (
        <div key={section} data-testid={`module-section-${section}`} className="flex items-center gap-1">
          <span className="uppercase tracking-wider text-[10px] text-muted-foreground/70 mr-1">
            {section}
          </span>
          {items.map((it) => {
            const disabled = !it.to;
            if (disabled) {
              return (
                <Tooltip key={it.label}>
                  <TooltipTrigger asChild>
                    <span
                      data-testid={`module-item-disabled-${it.label}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-muted-foreground/60 cursor-not-allowed"
                    >
                      <Sparkles className="h-3 w-3" />
                      {it.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Em breve</TooltipContent>
                </Tooltip>
              );
            }
            const active = isActive(pathname, it.to);
            return (
              <NavLink
                key={it.label}
                to={it.to}
                className={cn(
                  "px-2 py-0.5 rounded hover:bg-accent hover:text-accent-foreground transition-colors",
                  active && "bg-accent text-accent-foreground font-medium",
                )}
              >
                {it.label}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
