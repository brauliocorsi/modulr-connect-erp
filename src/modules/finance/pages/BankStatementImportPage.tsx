import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";

type ParsedRow = Record<string, any>;
type Mapping = { date: string; description: string; reference: string; amount: string; balance: string };

type Suggestion = {
  payment_id?: string;
  payment_name?: string;
  partner_name?: string;
  amount: number;
};

const TARGET_METHODS = ["MB Way", "Multibanco", "Getnet", "Transferência", "Sequra (BNPL)", "ScalaPay (BNPL)"];

export default function BankStatementImportPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [journalId, setJournalId] = useState<string>("");
  const [journals, setJournals] = useState<{ id: string; name: string }[]>([]);
  const [methods, setMethods] = useState<{ id: string; name: string }[]>([]);
  const [methodId, setMethodId] = useState<string>("");
  const [fileName, setFileName] = useState("");
  const [fileKind, setFileKind] = useState<"csv" | "xls" | "xlsx" | "">("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({ date: "", description: "", reference: "", amount: "", balance: "" });
  const [importId, setImportId] = useState<string | null>(null);
  const [lines, setLines] = useState<Array<{ id: string; date: string; description: string; reference: string; amount: number; suggestions: Suggestion[]; status: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("account_journals").select("id,name").eq("active", true).order("name")
      .then(({ data }) => setJournals(data ?? []));
    supabase.from("payment_methods").select("id,name").in("name", TARGET_METHODS).order("name")
      .then(({ data }) => setMethods(data ?? []));
  }, []);

  const onFile = async (f: File) => {
    setFileName(f.name);
    const ext = f.name.toLowerCase().split(".").pop() as any;
    setFileKind(ext === "csv" ? "csv" : ext === "xls" ? "xls" : "xlsx");
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: "", raw: false });
    if (!rows.length) return toast.error("Ficheiro sem dados");
    const cols = Object.keys(rows[0]);
    setHeaders(cols);
    setParsed(rows);
    // auto-guess mapping
    const guess = (re: RegExp) => cols.find((c) => re.test(c.toLowerCase())) ?? "";
    setMapping({
      date: guess(/data|date/),
      description: guess(/descri|desc|memo|histor/),
      reference: guess(/ref|doc/),
      amount: guess(/valor|amount|montante/),
      balance: guess(/saldo|balance/),
    });
  };

  const parseAmount = (v: any): number => {
    if (typeof v === "number") return v;
    if (!v) return 0;
    const s = String(v).replace(/\s/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    return parseFloat(s) || 0;
  };
  const parseDate = (v: any): string | null => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v);
    // dd/mm/yyyy
    const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? "20" + m[3] : m[3];
      return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    const d = new Date(s);
    return isNaN(+d) ? null : d.toISOString().slice(0, 10);
  };

  const startImport = async () => {
    if (!name || !journalId || !mapping.date || !mapping.amount) {
      return toast.error("Nome, diário, data e valor são obrigatórios");
    }
    setBusy(true);
    try {
      const { data: impId, error: e1 } = await supabase.rpc("bank_statement_import_create", {
        _name: name, _journal_id: journalId, _file_name: fileName, _file_kind: fileKind, _column_map: mapping as any,
      });
      if (e1) throw e1;
      setImportId(impId as string);

      const importedLines: typeof lines = [];
      for (const r of parsed) {
        const date = parseDate(r[mapping.date]);
        const amount = parseAmount(r[mapping.amount]);
        if (!date) continue;
        const { data: lineId } = await supabase.rpc("bank_statement_line_insert", {
          _import_id: impId, _occurred_on: date,
          _description: String(r[mapping.description] ?? ""),
          _reference: String(r[mapping.reference] ?? ""),
          _amount: amount, _balance: mapping.balance ? parseAmount(r[mapping.balance]) : null,
          _raw: r as any,
        });
        importedLines.push({
          id: lineId as string, date, description: String(r[mapping.description] ?? ""),
          reference: String(r[mapping.reference] ?? ""), amount, suggestions: [], status: "unmatched",
        });
      }

      // Auto-match: find customer_payments by amount + nearby date (±3 days)
      for (const ln of importedLines) {
        const dMin = new Date(ln.date); dMin.setDate(dMin.getDate() - 3);
        const dMax = new Date(ln.date); dMax.setDate(dMax.getDate() + 3);
        let q = supabase
          .from("customer_payments")
          .select("id,name,amount,partner_id,method_id,partners(name)")
          .eq("amount", Math.abs(ln.amount))
          .gte("payment_date", dMin.toISOString().slice(0, 10))
          .lte("payment_date", dMax.toISOString().slice(0, 10))
          .is("reconciled_at", null)
          .limit(3);
        if (methodId) q = q.eq("method_id", methodId);
        const { data: cands } = await q;
        ln.suggestions = (cands ?? []).map((c: any) => ({
          payment_id: c.id, payment_name: c.name, partner_name: c.partners?.name, amount: Number(c.amount),
        }));
        if (ln.suggestions.length === 1) ln.status = "suggested";
      }
      setLines(importedLines);
      setStep(3);
      toast.success(`${importedLines.length} linhas importadas`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao importar");
    } finally {
      setBusy(false);
    }
  };

  const confirmMatch = async (lineId: string, paymentId: string) => {
    const { error } = await supabase.rpc("bank_reconciliation_confirm_match", {
      _line_id: lineId, _customer_payment_id: paymentId, _supplier_payment_id: null,
    });
    if (error) return toast.error(error.message);
    setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, status: "confirmed" } : l)));
    toast.success("Conciliação confirmada");
  };

  return (
    <>
      <PageHeader title="Importar Extrato Bancário"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Importar Extrato" }]} />
      <PageBody>
        <div className="flex gap-2 mb-4 text-xs">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`px-3 py-1 rounded-full ${step === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {n}. {n === 1 ? "Upload" : n === 2 ? "Mapeamento" : "Conciliação"}
            </div>
          ))}
        </div>

        {step === 1 && (
          <Card className="p-6 max-w-xl">
            <div className="space-y-3">
              <div>
                <Label>Nome do lote</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Extrato Janeiro 2026" />
              </div>
              <div>
                <Label>Diário / Conta bancária</Label>
                <Select value={journalId} onValueChange={setJournalId}>
                  <SelectTrigger><SelectValue placeholder="Escolher diário" /></SelectTrigger>
                  <SelectContent>{journals.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tipo de pagamento (filtro de conciliação)</Label>
                <Select value={methodId || "all"} onValueChange={(v) => setMethodId(v === "all" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Todos os tipos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    {methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="text-xs text-muted-foreground mt-1">
                  Limita o auto-match aos recebimentos do tipo escolhido (MB Way, Multibanco, Getnet, Transferência, Sequra, ScalaPay…).
                </div>
              <div>
                <Label>Ficheiro (CSV / XLS / XLSX)</Label>
                <Input type="file" accept=".csv,.xls,.xlsx" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                {fileName && <div className="text-xs text-muted-foreground mt-1">{fileName} · {parsed.length} linhas</div>}
              </div>
              <Button disabled={!parsed.length || !name || !journalId} onClick={() => setStep(2)}>
                Continuar <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card className="p-6 max-w-2xl">
            <h3 className="font-medium mb-3">Mapear colunas</h3>
            <div className="grid grid-cols-2 gap-3">
              {(["date", "description", "reference", "amount", "balance"] as const).map((k) => (
                <div key={k}>
                  <Label className="capitalize">{k === "date" ? "Data" : k === "description" ? "Descrição" : k === "reference" ? "Referência" : k === "amount" ? "Valor" : "Saldo (opcional)"}</Label>
                  <Select value={mapping[k]} onValueChange={(v) => setMapping((m) => ({ ...m, [k]: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">—</SelectItem>
                      {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground mt-3">
              Prévia: {parsed.slice(0, 3).map((r, i) => (
                <div key={i}>{String(r[mapping.date] ?? "")} · {String(r[mapping.description] ?? "")} · {String(r[mapping.amount] ?? "")}</div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setStep(1)}>Voltar</Button>
              <Button onClick={startImport} disabled={busy || !mapping.date || !mapping.amount}>
                {busy ? "A importar…" : "Importar e auto-conciliar"} <Upload className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card className="p-4">
            <div className="mb-3 text-sm">
              {lines.filter((l) => l.status === "confirmed").length} de {lines.length} confirmadas ·
              {" "}{lines.filter((l) => l.status === "suggested").length} sugestões
            </div>
            <div className="overflow-auto border rounded">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2">Data</th>
                    <th className="text-left px-3 py-2">Descrição</th>
                    <th className="text-left px-3 py-2">Ref.</th>
                    <th className="text-right px-3 py-2">Valor</th>
                    <th className="text-left px-3 py-2">Sugestão</th>
                    <th className="text-left px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-1.5">{l.date}</td>
                      <td className="px-3 py-1.5">{l.description}</td>
                      <td className="px-3 py-1.5 text-xs font-mono">{l.reference}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(l.amount)}</td>
                      <td className="px-3 py-1.5">
                        {l.suggestions.length === 0 ? <span className="text-muted-foreground text-xs">—</span> : (
                          l.suggestions.map((s) => (
                            <div key={s.payment_id} className="flex items-center gap-2 text-xs">
                              <span>{s.payment_name} · {s.partner_name}</span>
                              {l.status !== "confirmed" && (
                                <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => confirmMatch(l.id, s.payment_id!)}>
                                  <CheckCircle2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          ))
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {l.status === "confirmed" ? <Badge className="bg-emerald-100 text-emerald-700">Confirmada</Badge> :
                         l.status === "suggested" ? <Badge variant="secondary">Sugerida</Badge> :
                         <Badge variant="outline" className="text-muted-foreground"><AlertCircle className="h-3 w-3 mr-1" />Sem match</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}
