import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import { PublicOrderStatusBadge } from "@/modules/helpdesk/components/TicketBadges";
import { Package, Truck, CreditCard, MessageSquare, Wrench, AlertCircle } from "lucide-react";

const PUBLIC_CATEGORIES = [
  { value: "order_status", label: "Status do pedido" },
  { value: "delivery_schedule", label: "Agendamento de entrega" },
  { value: "payment_question", label: "Pagamento" },
  { value: "damaged_product", label: "Produto danificado" },
  { value: "missing_part", label: "Peça em falta" },
  { value: "warranty_claim", label: "Garantia" },
  { value: "return_request", label: "Devolução" },
  { value: "complaint", label: "Reclamação" },
  { value: "general_question", label: "Dúvida geral" },
  { value: "other", label: "Outro" },
];

type Order = {
  ok?: boolean;
  order_number?: string;
  customer_name?: string;
  products?: { description: string; quantity: number }[];
  public_status?: string;
  estimated_ready_date?: string | null;
  delivery_status?: string | null;
  payment_status?: string | null;
  service_cases?: { case_number: string; status: string }[];
  error?: string;
};

type TokenState =
  | { kind: "loading" }
  | { kind: "valid"; customer_id: string; sale_order_id: string | null }
  | { kind: "invalid"; reason: string };

export default function CustomerPortalPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [tokenState, setTokenState] = useState<TokenState>({ kind: "loading" });
  const [order, setOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("general_question");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastTicketId, setLastTicketId] = useState<string | null>(null);
  const [followup, setFollowup] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("customer_portal_validate_token", { _token: token, _scope: null });
      if (error) {
        setTokenState({ kind: "invalid", reason: error.message });
        return;
      }
      const d: any = data ?? {};
      if (!d.ok) {
        setTokenState({ kind: "invalid", reason: d.error ?? "Token inválido" });
        return;
      }
      setTokenState({ kind: "valid", customer_id: d.customer_id, sale_order_id: d.sale_order_id });
    })();
  }, [token]);

  const loadOrder = useCallback(async () => {
    if (tokenState.kind !== "valid" || !tokenState.sale_order_id) return;
    setLoadingOrder(true);
    const { data, error } = await supabase.rpc("customer_portal_order_status", { _token: token });
    setLoadingOrder(false);
    if (error) {
      setOrder({ ok: false, error: error.message });
      return;
    }
    setOrder(data as Order);
  }, [tokenState, token]);

  useEffect(() => { loadOrder(); }, [loadOrder]);

  const submitTicket = async () => {
    if (!subject.trim()) return toast.error("Assunto é obrigatório");
    if (!description.trim()) return toast.error("Descrição é obrigatória");
    if (subject.length > 200) return toast.error("Assunto demasiado longo");
    if (description.length > 4000) return toast.error("Descrição demasiado longa");
    setSubmitting(true);
    const { data, error } = await supabase.rpc("customer_ticket_create", {
      _token: token,
      _payload: { category, subject, description, priority: "normal" },
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Pedido enviado!");
    setLastTicketId(data as string);
    setSubject(""); setDescription(""); setShowForm(false);
  };

  const sendFollowup = async () => {
    if (!lastTicketId || !followup.trim()) return;
    const { error } = await supabase.rpc("customer_ticket_add_message", {
      _token: token, _ticket_id: lastTicketId, _message: followup,
    });
    if (error) return toast.error(error.message);
    setFollowup("");
    toast.success("Mensagem enviada");
  };

  if (tokenState.kind === "loading") {
    return <PortalShell><div className="text-muted-foreground">A validar acesso…</div></PortalShell>;
  }
  if (tokenState.kind === "invalid") {
    return (
      <PortalShell>
        <Card className="p-6 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-destructive mb-2" />
          <h2 className="font-semibold">Acesso inválido</h2>
          <p className="text-sm text-muted-foreground mt-1">{tokenState.reason}</p>
        </Card>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      {loadingOrder && !order ? (
        <div className="text-muted-foreground">A carregar pedido…</div>
      ) : order && order.ok === false ? (
        <Card className="p-6">
          <AlertCircle className="h-6 w-6 text-destructive mb-2" />
          <div className="text-sm">{order.error ?? "Não foi possível carregar o pedido."}</div>
        </Card>
      ) : order ? (
        <>
          <Card className="p-5 mb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Pedido</div>
                <div className="text-2xl font-bold mt-1">{order.order_number}</div>
                <div className="text-sm text-muted-foreground">{order.customer_name}</div>
              </div>
              <PublicOrderStatusBadge status={order.public_status} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <StatusBox icon={Truck} label="Entrega" value={order.delivery_status ?? "—"} />
              <StatusBox icon={CreditCard} label="Pagamento" value={order.payment_status ?? "—"} />
              <StatusBox
                icon={Package}
                label="Pronto previsto"
                value={order.estimated_ready_date ? new Date(order.estimated_ready_date).toLocaleDateString("pt-PT") : "—"}
              />
            </div>
          </Card>

          {order.products && order.products.length > 0 && (
            <Card className="p-5 mb-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2"><Package className="h-4 w-4" /> Produtos</h3>
              <ul className="text-sm divide-y">
                {order.products.map((p, i) => (
                  <li key={i} className="py-1.5 flex justify-between gap-2">
                    <span>{p.description}</span>
                    <span className="text-muted-foreground">x{p.quantity}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {order.service_cases && order.service_cases.length > 0 && (
            <Card className="p-5 mb-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2"><Wrench className="h-4 w-4" /> Assistências</h3>
              <ul className="text-sm space-y-1">
                {order.service_cases.map((c) => (
                  <li key={c.case_number} className="flex justify-between">
                    <span className="font-mono">{c.case_number}</span>
                    <Badge variant="secondary">{c.status}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : null}

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Pedido ou reclamação</h3>
          {!showForm && (
            <Button size="sm" onClick={() => setShowForm(true)}>Abrir pedido</Button>
          )}
        </div>
        {showForm && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Categoria</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PUBLIC_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Assunto</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Descrição</label>
              <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} className="mt-1" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={submitTicket} disabled={submitting}>Enviar</Button>
            </div>
          </div>
        )}

        {lastTicketId && (
          <div className="mt-4 border-t pt-3 space-y-2">
            <div className="text-xs text-muted-foreground">Adicionar mensagem ao último pedido aberto</div>
            <Textarea rows={2} value={followup} onChange={(e) => setFollowup(e.target.value)} maxLength={2000} />
            <div className="flex justify-end">
              <Button size="sm" onClick={sendFollowup} disabled={!followup.trim()}>Enviar mensagem</Button>
            </div>
          </div>
        )}
      </Card>
    </PortalShell>
  );
}

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-primary grid place-items-center text-primary-foreground font-bold">U</div>
          <div>
            <div className="font-semibold">Portal do Cliente</div>
            <div className="text-xs text-muted-foreground">Acompanhe o seu pedido</div>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

function StatusBox({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="border rounded-md p-3 bg-card">
      <div className="text-xs text-muted-foreground flex items-center gap-1"><Icon className="h-3 w-3" /> {label}</div>
      <div className="font-medium mt-1">{value}</div>
    </div>
  );
}
