import { ReactNode } from "react";
import { ScanLine } from "lucide-react";
import { ScanFeedback } from "./useScanner";

const FLASH: Record<ScanFeedback, string> = {
  ok: "ring-emerald-500 bg-emerald-500/20",
  warn: "ring-amber-500 bg-amber-500/20",
  error: "ring-rose-500 bg-rose-500/20",
  info: "ring-sky-500 bg-sky-500/20",
};

export function ScanInput({
  inputRef, code, setCode, onSubmit, placeholder, flash,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  code: string;
  setCode: (s: string) => void;
  onSubmit: () => void;
  placeholder: string;
  flash: ScanFeedback | null;
}) {
  return (
    <div className={`rounded-xl ring-4 ring-slate-700 transition-colors p-4 ${flash ? FLASH[flash] : "bg-slate-900"}`}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <label className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1 mb-2">
          <ScanLine className="h-3 w-3" /> Aguardando leitura
        </label>
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={placeholder}
          autoFocus
          autoComplete="off"
          className="w-full bg-transparent text-3xl font-mono outline-none text-white placeholder:text-slate-600"
        />
      </form>
    </div>
  );
}

export function HistoryPanel({ history }: { history: { ts: number; text: string; tone: ScanFeedback }[] }) {
  return (
    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Últimas leituras</div>
      <ul className="space-y-1 text-sm max-h-[60vh] overflow-auto">
        {history.length === 0 && <li className="text-slate-600 text-xs">—</li>}
        {history.map((h) => {
          const color = h.tone === "ok" ? "text-emerald-300" : h.tone === "warn" ? "text-amber-300" : h.tone === "error" ? "text-rose-300" : "text-sky-300";
          return (
            <li key={h.ts} className={`flex items-start gap-2 ${color}`}>
              <span className="font-mono text-xs text-slate-500">{new Date(h.ts).toLocaleTimeString().slice(0,8)}</span>
              <span className="leading-snug">{h.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ScanLayout({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <div className="text-slate-400 text-sm">{subtitle}</div>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
