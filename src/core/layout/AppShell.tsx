import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/core/auth/AuthProvider";
import { useInstalledModules } from "@/core/modules/useInstalledModules";
import { MODULES, getModuleByPath } from "@/core/modules/registry";
import { GlobalSearch } from "@/core/search/GlobalSearch";
import { NotificationsBell } from "@/core/notifications/NotificationsBell";
import { MessagesBell } from "@/core/notifications/MessagesBell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Grid3x3, Search, ChevronDown, LogOut, User as UserIcon, Settings as SettingsIcon } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export default function AppShell() {
  const { user, signOut } = useAuth();
  const installed = useInstalledModules();
  const loc = useLocation();
  const nav = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeModule = getModuleByPath(loc.pathname);
  const ALWAYS_ON = new Set(["settings", "hr", "discuss", "finance", "cashbox", "service", "helpdesk"]);
  const visibleModules = MODULES.filter((m) => ALWAYS_ON.has(m.id as string) || installed.data?.[m.id as string]);

  const sectionedMenu = activeModule
    ? activeModule.menu.reduce<Record<string, typeof activeModule.menu>>((acc, item) => {
        const k = item.section ?? "Menu";
        (acc[k] ??= []).push(item);
        return acc;
      }, {})
    : {};

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* TOP BAR */}
      <header className="h-12 flex items-center px-2 bg-topbar text-topbar-foreground border-b border-black/20 z-30">
        <Button variant="ghost" size="icon" className="text-topbar-foreground hover:bg-white/10" onClick={() => setAppsOpen((v) => !v)}>
          <Grid3x3 className="h-5 w-5" />
        </Button>
        <Link to="/" className="flex items-center gap-2 ml-1 mr-3 font-semibold">
          <div className="h-7 w-7 rounded bg-primary grid place-items-center text-primary-foreground text-sm">U</div>
          <span className="hidden sm:inline">UP Móveis</span>
        </Link>

        {activeModule && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="text-topbar-foreground hover:bg-white/10 gap-1">
                <activeModule.icon className="h-4 w-4" />
                {activeModule.name}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {visibleModules.map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => nav(m.basePath)}>
                  <m.icon className="h-4 w-4 mr-2" /> {m.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setSearchOpen(true)}
          className="hidden md:flex items-center gap-2 text-sm text-white/60 hover:text-white border border-white/15 rounded-md px-3 py-1.5 mr-2"
        >
          <Search className="h-4 w-4" />
          Buscar…
          <kbd className="ml-2 text-[10px] border border-white/20 rounded px-1">⌘K</kbd>
        </button>

        <MessagesBell />
        <NotificationsBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-topbar-foreground hover:bg-white/10 gap-2">
              <div className="h-7 w-7 rounded-full bg-primary grid place-items-center text-primary-foreground text-xs">
                {user?.email?.[0]?.toUpperCase()}
              </div>
              <span className="hidden sm:inline text-sm">{user?.email}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => nav("/settings/users")}>
              <UserIcon className="h-4 w-4 mr-2" /> Meu perfil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => nav("/settings/apps")}>
              <SettingsIcon className="h-4 w-4 mr-2" /> Configurações
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await signOut();
                nav("/login");
              }}
            >
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* APP SWITCHER OVERLAY */}
      {appsOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm pt-16 px-6" onClick={() => setAppsOpen(false)}>
          <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" onClick={(e) => e.stopPropagation()}>
            {visibleModules.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  nav(m.basePath);
                  setAppsOpen(false);
                }}
                className="group flex flex-col items-center gap-3 p-6 rounded-xl border bg-card hover:shadow-elegant transition-all hover:-translate-y-0.5"
              >
                <div className={cn("h-14 w-14 rounded-xl grid place-items-center text-white", m.color)}>
                  <m.icon className="h-7 w-7" />
                </div>
                <div className="text-center">
                  <div className="font-semibold">{m.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{m.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* BODY */}
      <div className="flex-1 flex min-h-0">
        {activeModule && (
          <aside className="hidden md:flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
            <div className="p-3 border-b">
              <div className="text-sm font-semibold">{activeModule.name}</div>
              <div className="text-xs text-muted-foreground">{activeModule.description}</div>
            </div>
            <nav className="flex-1 overflow-auto p-2 space-y-4">
              {Object.entries(sectionedMenu).map(([section, items]) => (
                <div key={section}>
                  <div className="o-section-title px-2 mb-1">{section}</div>
                  {items.map((it) => (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      end={it.to === activeModule.basePath}
                      className={({ isActive }) =>
                        cn(
                          "block px-2 py-1.5 rounded text-sm hover:bg-sidebar-accent",
                          isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        )
                      }
                    >
                      {it.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
          </aside>
        )}
        <main className="flex-1 min-w-0 overflow-auto">
          <Outlet />
        </main>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
