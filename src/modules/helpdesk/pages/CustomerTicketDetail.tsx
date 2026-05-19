import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  TicketStatusBadge,
  TicketCategoryBadge,
  TicketPriorityBadge,
  CONVERTIBLE_CATEGORIES,
} from "../components/TicketBadges";
import { RecordTimeline } from "@/core/timeline/RecordTimeline";
import { RecordTasks } from "@/core/tasks/RecordTasks";
import { RecordConversations } from "@/core/conversations/RecordConversations";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Wrench, X, Send, EyeOff, Eye } from "lucide-react";

type Ticket = {
  id: string;
  ticket_number: string;
  customer_id: string;
  sale_order_id: string | null;
  service_case_id: string | null;
  source: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  description: string | null;
  assigned_to: string | null;
  created_at: string;
  customer?: { name: string } | null;
  sale_order?: { name: string } | null;
  service_case?: { case_number: string } | null;
};

type Message = {
  id: string;
  sender_type: string;
  message: string;
  internal: boolean;
  created_at: string;
};

export default function CustomerTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("customer_tickets")
      .select("*, customer:partners!customer_tickets_customer_id_fkey(name), sale_order:sale_orders!customer_tickets_sale_order_id_fkey(name), service_case:service_cases!customer_tickets_service_case_id_fkey(case_number)")
      .eq("id", id)
      .maybeSingle();
    if (error) toast.error(error.message);
    setTicket((data as any) ?? null);
    const { data: msgs } = await supabase
      .from("customer_ticket_messages")
      .select("id, sender_type, message, internal, created_at")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });
    setMessages((msgs as any) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`ticket-${id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "customer_ticket_messages", filter: `ticket_id=eq.${id}` },
        load,
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "customer_tickets", filter: `id=eq.${id}` },
        load,
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  const sendMessage = async () => {
    if (!id || !text.trim()) return;
    setBusy("send");
    const { error } = await supabase.rpc("helpdesk_ticket_add_message", {
      _ticket_id: id, _message: text, _internal: isInternal,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    setText("");
    toast.success(isInternal ? "Nota interna adicionada" : "Mensagem enviada");
  };

  const convertToCase = async () => {
    if (!id || !ticket) return;
    setBusy("convert");
    const { data, error } = await supabase.rpc("helpdesk_ticket_convert_to_service_case", {
      _ticket_id: id, _payload: {},
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Convertido em service case");
    if (data) nav(`/service/requests/${data}`);
    else load();
  };

  const closeTicket = async () => {
    if (!id) return;
    setBusy("close");
    const { error } = await supabase.rpc("helpdesk_ticket_close", {
      _ticket_id: id, _resolution: "Encerrado via helpdesk",
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Ticket encerrado");
  };

  if (loading || !ticket) {
    return (
      <PageBody><div className="text-sm text-muted-foreground">A carregar…</div></PageBody>
    );
  }

  const isConvertible = CONVERTIBLE_CATEGORIES.has(ticket.category);
  const alreadyLinked = !!ticket.service_case_id;
  const isClosed = ["closed", "cancelled"].includes(ticket.status);

  return (
    <>
      <PageHeader
        title={`Ticket ${ticket.ticket_number}`}
        breadcrumb={[{ label: "Helpdesk", to: "/helpdesk/tickets" }, { label: ticket.ticket_number }]}
        actions={
          <div className="flex gap-2">
            {alreadyLinked ? (
              <Button size="sm" variant="outline" asChild>
                <Link to={`/service/requests/${ticket.service_case_id}`}>
                  <Wrench className="h-4 w-4 mr-1" /> Service Case {ticket.service_case?.case_number}
                </Link>
              </Button>
            ) : (
              <Button
                size="sm" variant="outline"
                disabled={!isConvertible || busy === "convert" || isClosed}
                title={!isConvertible ? "Categoria não convertível sem force" : ""}
                onClick={convertToCase}
              >
                <Wrench className="h-4 w-4 mr-1" /> Converter em assistência
              </Button>
            )}
            <Button
              size="sm" variant="destructive"
              disabled={isClosed || busy === "close"}
              onClick={closeTicket}
            >
              <X className="h-4 w-4 mr-1" /> Encerrar
            </Button>
          </div>
        }
      />
      <PageBody>
        <Card className="p-4 mb-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Field label="Status"><TicketStatusBadge status={ticket.status} /></Field>
          <Field label="Categoria"><TicketCategoryBadge category={ticket.category} /></Field>
          <Field label="Prioridade"><TicketPriorityBadge priority={ticket.priority} /></Field>
          <Field label="Cliente">{ticket.customer?.name ?? "—"}</Field>
          <Field label="Pedido">
            {ticket.sale_order ? (
              <Link className="underline text-primary" to={`/sales/orders/${ticket.sale_order_id}`}>{ticket.sale_order.name}</Link>
            ) : "—"}
          </Field>
          <Field label="Criado">
            {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true, locale: ptBR })}
          </Field>
          <Field label="Origem">{ticket.source}</Field>
          <Field label="Atribuído a">{ticket.assigned_to ? <span className="font-mono text-xs">{ticket.assigned_to.slice(0, 8)}…</span> : "—"}</Field>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <Card className="p-4">
              <h3 className="font-semibold mb-1">{ticket.subject}</h3>
              {ticket.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.description}</p>}
            </Card>

            <Card className="p-4">
              <Tabs defaultValue="public">
                <TabsList>
                  <TabsTrigger value="public"><Eye className="h-3 w-3 mr-1" /> Mensagens</TabsTrigger>
                  <TabsTrigger value="internal"><EyeOff className="h-3 w-3 mr-1" /> Notas internas</TabsTrigger>
                </TabsList>
                <TabsContent value="public" className="space-y-2">
                  <MessageList items={messages.filter((m) => !m.internal)} />
                </TabsContent>
                <TabsContent value="internal" className="space-y-2">
                  <MessageList items={messages.filter((m) => m.internal)} />
                </TabsContent>
              </Tabs>

              <div className="mt-3 border-t pt-3 space-y-2">
                <Textarea
                  rows={3}
                  placeholder={isInternal ? "Nota interna (não visível ao cliente)" : "Mensagem pública"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={isClosed}
                />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex gap-1 text-xs">
                    <button
                      className={"px-2 py-1 rounded " + (!isInternal ? "bg-primary text-primary-foreground" : "bg-muted")}
                      onClick={() => setIsInternal(false)} disabled={isClosed}
                    >Pública</button>
                    <button
                      className={"px-2 py-1 rounded " + (isInternal ? "bg-primary text-primary-foreground" : "bg-muted")}
                      onClick={() => setIsInternal(true)} disabled={isClosed}
                    >Interna</button>
                  </div>
                  <Button size="sm" onClick={sendMessage} disabled={!text.trim() || busy === "send" || isClosed}>
                    <Send className="h-4 w-4 mr-1" /> Enviar
                  </Button>
                </div>
              </div>
            </Card>

            <RecordConversations entityType="customer_ticket" entityId={ticket.id} />
          </div>

          <div className="space-y-3">
            <RecordTasks entityType="customer_ticket" entityId={ticket.id} />
            <RecordTimeline entityType="customer_ticket" entityId={ticket.id} includeCustomerVisible />
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function MessageList({ items }: { items: Message[] }) {
  if (items.length === 0) return <div className="text-sm text-muted-foreground py-4">Sem mensagens.</div>;
  return (
    <div className="divide-y">
      {items.map((m) => (
        <div key={m.id} className="py-2">
          <div className="text-[11px] text-muted-foreground">
            {m.sender_type} · {formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: ptBR })}
            {m.internal && <span className="ml-1 text-amber-600">(interno)</span>}
          </div>
          <div className="text-sm whitespace-pre-wrap">{m.message}</div>
        </div>
      ))}
    </div>
  );
}
