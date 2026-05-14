import { stateLabel } from "@/lib/picking";

const TONES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  sent: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  rfq_sent: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  confirmed: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  waiting: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  in_progress: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  ready: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  done: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  posted: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  paid: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  cancelled: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  new: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  triaged: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  scheduled: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

export function StateBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const cls = TONES[value] ?? "bg-muted text-foreground";
  return (
    <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " + cls}>
      {stateLabel(value)}
    </span>
  );
}
