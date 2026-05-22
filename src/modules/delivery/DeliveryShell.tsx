import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/core/auth/AuthProvider";
import { Truck, Home, Wallet, LogOut, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DeliveryShell() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="h-14 flex items-center px-3 bg-slate-900 border-b border-slate-800 gap-2">
        <Truck className="h-5 w-5 text-emerald-400" />
        <div className="font-semibold">Entregas</div>
        <div className="flex-1" />
        <span className="text-xs text-slate-400 hidden sm:inline">{user?.email}</span>
        <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-slate-800"
          onClick={async () => { await signOut(); nav("/login"); }}>
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      <nav className="flex border-b border-slate-800 bg-slate-900">
        <NavLink to="/delivery" end className={({ isActive }) =>
          `flex-1 text-center py-3 text-sm ${isActive ? "text-emerald-400 border-b-2 border-emerald-400" : "text-slate-400"}`}>
          <Home className="h-4 w-4 inline mr-1" /> Hoje
        </NavLink>
        <NavLink to="/delivery/cashbox" className={({ isActive }) =>
          `flex-1 text-center py-3 text-sm ${isActive ? "text-emerald-400 border-b-2 border-emerald-400" : "text-slate-400"}`}>
          <Wallet className="h-4 w-4 inline mr-1" /> Caixa
        </NavLink>
        <NavLink to="/delivery/discuss" className={({ isActive }) =>
          `flex-1 text-center py-3 text-sm ${isActive ? "text-emerald-400 border-b-2 border-emerald-400" : "text-slate-400"}`}>
          <MessageCircle className="h-4 w-4 inline mr-1" /> Conversas
        </NavLink>
      </nav>


      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
