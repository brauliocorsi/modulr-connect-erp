import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/core/auth/AuthProvider";
import { Home, LogOut, ScanLine } from "lucide-react";

export default function BarcodeShell() {
  const { signOut, user } = useAuth();
  const nav = useNavigate();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-40">
        <NavLink to="/barcode" className="flex items-center gap-2 font-bold text-lg tracking-wide">
          <ScanLine className="h-6 w-6 text-emerald-400" />
          <span>BARCODE</span>
        </NavLink>
        <span className="text-slate-500">/</span>
        <NavLink to="/barcode" className="text-slate-300 hover:text-white text-sm flex items-center gap-1">
          <Home className="h-4 w-4" /> Início
        </NavLink>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <span className="hidden sm:inline">{user?.email}</span>
          <button onClick={() => nav("/")} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs">Sair do scanner</button>
          <button onClick={() => signOut()} className="p-2 rounded hover:bg-slate-800" title="Logout"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
