import { ListView } from "@/core/layout/ListView";
import { SimpleForm } from "@/core/layout/SimpleForm";

export const JournalsList = () => (
  <ListView
    title="Diários / Contas"
    breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Diários" }]}
    table="account_journals"
    searchColumn="name"
    createTo="/finance/journals/new"
    rowLink={(r: any) => `/finance/journals/${r.id}`}
    columns={[
      { key: "code", header: "Código" },
      { key: "name", header: "Nome" },
      { key: "type", header: "Tipo" },
      { key: "currency", header: "Moeda" },
      { key: "active", header: "Ativo", render: (r: any) => (r.active ? "Sim" : "Não") },
    ]}
  />
);

export const JournalForm = () => (
  <SimpleForm
    table="account_journals"
    title="Diário"
    basePath="/finance/journals"
    breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Diários", to: "/finance/journals" }, { label: "Editar" }]}
    fields={[
      { name: "code", label: "Código", required: true },
      { name: "name", label: "Nome", required: true },
      { name: "type", label: "Tipo", type: "select", required: true, default: "cash",
        options: [
          { value: "cash", label: "Caixa" },
          { value: "bank", label: "Banco" },
          { value: "card", label: "Cartão" },
          { value: "other", label: "Outro" },
        ]
      },
      { name: "currency", label: "Moeda", default: "EUR" },
      { name: "active", label: "Ativo", type: "boolean", default: true },
    ]}
  />
);

export const MethodsList = () => (
  <ListView
    title="Métodos de Pagamento"
    breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Métodos" }]}
    table="payment_methods"
    select="id, code, name, active, account_journals(name)"
    searchColumn="name"
    createTo="/finance/methods/new"
    rowLink={(r: any) => `/finance/methods/${r.id}`}
    columns={[
      { key: "code", header: "Código" },
      { key: "name", header: "Nome" },
      { key: "journal", header: "Diário padrão", render: (r: any) => r.account_journals?.name ?? "—" },
      { key: "active", header: "Ativo", render: (r: any) => (r.active ? "Sim" : "Não") },
    ]}
  />
);

export const MethodForm = () => (
  <SimpleForm
    table="payment_methods"
    title="Método de Pagamento"
    basePath="/finance/methods"
    breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Métodos", to: "/finance/methods" }, { label: "Editar" }]}
    fields={[
      { name: "code", label: "Código", required: true },
      { name: "name", label: "Nome", required: true },
      { name: "default_journal_id", label: "Diário padrão", type: "select",
        optionsFrom: { table: "account_journals", value: "id", label: "name", filter: (q) => q.eq("active", true) }
      },
      { name: "confirmation_mode", label: "Confirmação", type: "select", required: true, default: "auto",
        options: [
          { value: "auto", label: "Automática (ex: Dinheiro)" },
          { value: "pending_finance", label: "Pendente do financeiro (ex: Multibanco)" },
          { value: "pending_delivery", label: "Pendente da entrega (entregador confirma)" },
        ]
      },
      { name: "feeds_cash_session", label: "Alimenta caixa da loja", type: "boolean", default: false },
      { name: "requires_reference", label: "Exige referência", type: "boolean", default: false },
      { name: "active", label: "Ativo", type: "boolean", default: true },
    ]}
  />
);

export const CostCentersList = () => (
  <ListView
    title="Centros de Custo"
    breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Centros de Custo" }]}
    table="cost_centers"
    searchColumn="name"
    createTo="/finance/cost_centers/new"
    rowLink={(r: any) => `/finance/cost_centers/${r.id}`}
    columns={[
      { key: "code", header: "Código" },
      { key: "name", header: "Nome" },
      { key: "active", header: "Ativo", render: (r: any) => (r.active ? "Sim" : "Não") },
    ]}
  />
);

export const CostCenterForm = () => (
  <SimpleForm
    table="cost_centers"
    title="Centro de Custo"
    basePath="/finance/cost_centers"
    breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Centros de Custo", to: "/finance/cost_centers" }, { label: "Editar" }]}
    fields={[
      { name: "code", label: "Código", required: true },
      { name: "name", label: "Nome", required: true },
      { name: "parent_id", label: "Pai", type: "select",
        optionsFrom: { table: "cost_centers", value: "id", label: "name", filter: (q) => q.eq("active", true) } },
      { name: "active", label: "Ativo", type: "boolean", default: true },
    ]}
  />
);
