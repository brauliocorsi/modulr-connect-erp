
-- =========================================================
-- UP MÓVEIS ERP — Release 1 schema (core + products + partners + stock + sales + purchase)
-- =========================================================

-- ---------- ENUMS ----------
create type public.app_module as enum ('core','products','sales','purchase','inventory');
create type public.permission_action as enum ('view','create','edit','delete','export');
create type public.product_type as enum ('storable','consumable','service');
create type public.partner_kind as enum ('individual','company');
create type public.location_type as enum ('internal','supplier','customer','transit','inventory_loss','production','view');
create type public.picking_state as enum ('draft','waiting','ready','done','cancelled');
create type public.picking_kind as enum ('incoming','outgoing','internal','manufacturing','return');
create type public.removal_strategy as enum ('fifo','lifo','fefo','closest');
create type public.sale_state as enum ('draft','sent','confirmed','done','cancelled');
create type public.purchase_state as enum ('draft','rfq_sent','confirmed','done','cancelled');
create type public.bom_type as enum ('normal','phantom','subcontract');

-- ---------- helper: updated_at ----------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- CORE: companies ----------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- CORE: profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  job_title text,
  department text,
  language text default 'pt-BR',
  active boolean not null default true,
  company_id uuid references public.companies(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- CORE: installed_modules ----------
create table public.installed_modules (
  module app_module primary key,
  installed boolean not null default true,
  installed_at timestamptz not null default now()
);

-- ---------- CORE: groups & permissions ----------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  module app_module not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.group_permissions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  module app_module not null,
  entity text not null,
  action permission_action not null,
  unique (group_id, module, entity, action)
);

create table public.user_groups (
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  primary key (user_id, group_id)
);

-- ---------- CORE: security definer helpers ----------
create or replace function public.has_group(_uid uuid, _code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_groups ug
    join public.groups g on g.id = ug.group_id
    where ug.user_id = _uid and g.code = _code
  );
$$;

create or replace function public.has_permission(_uid uuid, _module app_module, _entity text, _action permission_action)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_groups ug
    join public.group_permissions gp on gp.group_id = ug.group_id
    where ug.user_id = _uid
      and gp.module = _module
      and gp.entity = _entity
      and gp.action = _action
  ) or public.has_group(_uid, 'system_admin');
$$;

create or replace function public.is_module_installed(_module app_module)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select installed from public.installed_modules where module = _module), false);
$$;

-- ---------- CORE: notifications ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module app_module not null,
  type text not null,
  title text not null,
  body text,
  link text,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications(user_id, read_at);

-- ---------- CORE: chatter (messages on records) ----------
create table public.record_messages (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  record_id uuid not null,
  author_id uuid references auth.users(id),
  kind text not null default 'comment', -- comment | log | note
  body text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index on public.record_messages(record_type, record_id, created_at);

-- ---------- CORE: module events bus ----------
create table public.module_events (
  id uuid primary key default gen_random_uuid(),
  source_module app_module not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- CORE: saved searches / favorites ----------
create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module app_module not null,
  entity text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- PARTNERS ----------
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind partner_kind not null default 'company',
  is_customer boolean not null default false,
  is_supplier boolean not null default false,
  email text,
  phone text,
  tax_id text,
  street text,
  city text,
  state text,
  zip text,
  country text default 'BR',
  notes text,
  active boolean not null default true,
  company_id uuid references public.companies(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.partners(name);

-- ---------- PRODUCTS: uom, categories, attributes ----------
create table public.product_uom (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  ratio numeric not null default 1, -- relative to reference of category
  category text not null default 'unit'
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.product_categories(id) on delete set null,
  removal_strategy removal_strategy not null default 'fifo',
  created_at timestamptz not null default now()
);

create table public.product_attributes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_type text not null default 'select' -- select | radio | color
);

create table public.product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.product_attributes(id) on delete cascade,
  name text not null,
  color text
);

-- ---------- PRODUCTS: templates and variants ----------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  internal_ref text,
  type product_type not null default 'storable',
  category_id uuid references public.product_categories(id),
  uom_id uuid references public.product_uom(id),
  purchase_uom_id uuid references public.product_uom(id),
  list_price numeric not null default 0,
  standard_cost numeric not null default 0,
  weight numeric default 0,
  volume numeric default 0,
  description text,
  sales_description text,
  purchase_description text,
  image_url text,
  can_be_sold boolean not null default true,
  can_be_purchased boolean not null default true,
  can_be_manufactured boolean not null default false,
  active boolean not null default true,
  company_id uuid references public.companies(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.products(name);
create index on public.products(internal_ref);

create table public.product_template_attributes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  attribute_id uuid not null references public.product_attributes(id) on delete cascade,
  unique (product_id, attribute_id)
);
create table public.product_template_attribute_values (
  id uuid primary key default gen_random_uuid(),
  template_attribute_id uuid not null references public.product_template_attributes(id) on delete cascade,
  value_id uuid not null references public.product_attribute_values(id) on delete cascade,
  price_extra numeric not null default 0,
  unique (template_attribute_id, value_id)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text unique,
  barcode text,
  price_extra numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.product_variant_values (
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  value_id uuid not null references public.product_attribute_values(id) on delete cascade,
  primary key (variant_id, value_id)
);

create table public.product_suppliers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  supplier_sku text,
  price numeric not null default 0,
  min_qty numeric not null default 1,
  lead_time_days int not null default 0,
  priority int not null default 1
);

-- ---------- PRODUCTS: BOM (multilevel) ----------
create table public.boms (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  code text,
  type bom_type not null default 'normal',
  quantity numeric not null default 1,
  uom_id uuid references public.product_uom(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.bom_lines (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null references public.boms(id) on delete cascade,
  component_product_id uuid not null references public.products(id),
  component_variant_id uuid references public.product_variants(id),
  quantity numeric not null default 1,
  uom_id uuid references public.product_uom(id),
  sequence int not null default 10
);
create table public.bom_operations (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null references public.boms(id) on delete cascade,
  name text not null,
  workcenter text,
  duration_minutes numeric not null default 0,
  sequence int not null default 10
);

-- ---------- STOCK: warehouses & locations ----------
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  address text,
  active boolean not null default true,
  company_id uuid references public.companies(id),
  created_at timestamptz not null default now()
);

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid references public.warehouses(id) on delete cascade,
  parent_id uuid references public.stock_locations(id) on delete set null,
  name text not null,
  full_path text,
  type location_type not null default 'internal',
  is_zone boolean not null default false,
  is_bin boolean not null default false,
  removal_strategy removal_strategy,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.putaway_rules (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete cascade,
  destination_location_id uuid not null references public.stock_locations(id) on delete cascade,
  priority int not null default 1
);

-- ---------- STOCK: lots/serials ----------
create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  name text not null,
  expiration_date date,
  created_at timestamptz not null default now(),
  unique (product_id, name)
);

-- ---------- STOCK: quants (on hand by product/variant/location/lot) ----------
create table public.stock_quants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  location_id uuid not null references public.stock_locations(id) on delete cascade,
  lot_id uuid references public.stock_lots(id) on delete set null,
  quantity numeric not null default 0,
  reserved_quantity numeric not null default 0,
  updated_at timestamptz not null default now()
);
create index on public.stock_quants(product_id, location_id);

-- ---------- STOCK: pickings & moves ----------
create table public.stock_pickings (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- e.g. WH/IN/00001
  kind picking_kind not null,
  state picking_state not null default 'draft',
  warehouse_id uuid references public.warehouses(id),
  source_location_id uuid references public.stock_locations(id),
  destination_location_id uuid references public.stock_locations(id),
  partner_id uuid references public.partners(id),
  origin text, -- e.g. SO00001 / PO00001
  scheduled_at timestamptz default now(),
  done_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  picking_id uuid references public.stock_pickings(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  lot_id uuid references public.stock_lots(id),
  uom_id uuid references public.product_uom(id),
  source_location_id uuid not null references public.stock_locations(id),
  destination_location_id uuid not null references public.stock_locations(id),
  quantity numeric not null default 0,
  quantity_done numeric not null default 0,
  state picking_state not null default 'draft',
  reference text,
  created_at timestamptz not null default now()
);

create table public.reordering_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id),
  warehouse_id uuid not null references public.warehouses(id),
  location_id uuid references public.stock_locations(id),
  min_qty numeric not null default 0,
  max_qty numeric not null default 0,
  multiple_qty numeric not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  state text not null default 'draft', -- draft | in_progress | done | cancelled
  location_id uuid references public.stock_locations(id),
  scheduled_at timestamptz default now(),
  done_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.inventory_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.inventory_adjustments(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  location_id uuid not null references public.stock_locations(id),
  lot_id uuid references public.stock_lots(id),
  theoretical_qty numeric not null default 0,
  counted_qty numeric not null default 0,
  difference numeric generated always as (counted_qty - theoretical_qty) stored
);

-- ---------- SALES ----------
create table public.pricelists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'BRL',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.pricelist_items (
  id uuid primary key default gen_random_uuid(),
  pricelist_id uuid not null references public.pricelists(id) on delete cascade,
  product_id uuid references public.products(id),
  category_id uuid references public.product_categories(id),
  min_qty numeric not null default 0,
  fixed_price numeric,
  discount_pct numeric
);

create table public.sale_orders (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- SO00001
  partner_id uuid not null references public.partners(id),
  state sale_state not null default 'draft',
  pricelist_id uuid references public.pricelists(id),
  salesperson_id uuid references auth.users(id),
  date_order timestamptz not null default now(),
  validity_date date,
  amount_untaxed numeric not null default 0,
  amount_tax numeric not null default 0,
  amount_total numeric not null default 0,
  notes text,
  warehouse_id uuid references public.warehouses(id),
  company_id uuid references public.companies(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.sale_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sale_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  description text,
  quantity numeric not null default 1,
  uom_id uuid references public.product_uom(id),
  unit_price numeric not null default 0,
  discount_pct numeric not null default 0,
  tax_pct numeric not null default 0,
  subtotal numeric not null default 0,
  sequence int not null default 10
);

-- ---------- PURCHASE ----------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- PO00001
  partner_id uuid not null references public.partners(id),
  state purchase_state not null default 'draft',
  buyer_id uuid references auth.users(id),
  date_order timestamptz not null default now(),
  expected_date date,
  amount_untaxed numeric not null default 0,
  amount_tax numeric not null default 0,
  amount_total numeric not null default 0,
  notes text,
  warehouse_id uuid references public.warehouses(id),
  origin text,
  company_id uuid references public.companies(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  description text,
  quantity numeric not null default 1,
  uom_id uuid references public.product_uom(id),
  unit_price numeric not null default 0,
  tax_pct numeric not null default 0,
  subtotal numeric not null default 0,
  sequence int not null default 10
);

-- ---------- updated_at triggers ----------
do $$ declare t text;
begin
  for t in select unnest(array[
    'companies','profiles','partners','products','warehouses',
    'sale_orders','purchase_orders','stock_pickings'
  ]) loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
      for each row execute function public.tg_set_updated_at();', t);
  end loop;
end $$;

-- ---------- profile auto-create on signup ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  -- give every new user the basic groups so they can use the app
  insert into public.user_groups (user_id, group_id)
  select new.id, g.id from public.groups g where g.code in ('sales_user','purchase_user','inventory_user','products_user');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- ENABLE RLS ----------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- RLS policies ----------
-- profiles: read all authenticated, update self, admin all
create policy "profiles_select" on public.profiles for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "profiles_admin_all" on public.profiles for all to authenticated using (public.has_group(auth.uid(),'system_admin')) with check (public.has_group(auth.uid(),'system_admin'));

-- companies: all authenticated read; admin writes
create policy "companies_read" on public.companies for select to authenticated using (true);
create policy "companies_admin" on public.companies for all to authenticated using (public.has_group(auth.uid(),'system_admin')) with check (public.has_group(auth.uid(),'system_admin'));

-- installed_modules: read all, write admin
create policy "im_read" on public.installed_modules for select to authenticated using (true);
create policy "im_admin" on public.installed_modules for all to authenticated using (public.has_group(auth.uid(),'system_admin')) with check (public.has_group(auth.uid(),'system_admin'));

-- groups & permissions: read all, admin write
create policy "g_read" on public.groups for select to authenticated using (true);
create policy "g_admin" on public.groups for all to authenticated using (public.has_group(auth.uid(),'system_admin')) with check (public.has_group(auth.uid(),'system_admin'));
create policy "gp_read" on public.group_permissions for select to authenticated using (true);
create policy "gp_admin" on public.group_permissions for all to authenticated using (public.has_group(auth.uid(),'system_admin')) with check (public.has_group(auth.uid(),'system_admin'));
create policy "ug_read" on public.user_groups for select to authenticated using (true);
create policy "ug_admin" on public.user_groups for all to authenticated using (public.has_group(auth.uid(),'system_admin')) with check (public.has_group(auth.uid(),'system_admin'));

-- notifications: per user
create policy "notif_self_read" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notif_self_update" on public.notifications for update to authenticated using (user_id = auth.uid());
create policy "notif_insert_any_auth" on public.notifications for insert to authenticated with check (true);

-- record_messages: any authenticated can read/insert; author/admin can update/delete
create policy "rm_read" on public.record_messages for select to authenticated using (true);
create policy "rm_insert" on public.record_messages for insert to authenticated with check (author_id = auth.uid());
create policy "rm_update" on public.record_messages for update to authenticated using (author_id = auth.uid() or public.has_group(auth.uid(),'system_admin'));
create policy "rm_delete" on public.record_messages for delete to authenticated using (author_id = auth.uid() or public.has_group(auth.uid(),'system_admin'));

-- module_events: read all auth, insert any auth, admin manage
create policy "me_read" on public.module_events for select to authenticated using (true);
create policy "me_insert" on public.module_events for insert to authenticated with check (true);
create policy "me_admin" on public.module_events for all to authenticated using (public.has_group(auth.uid(),'system_admin')) with check (public.has_group(auth.uid(),'system_admin'));

-- saved_searches per user
create policy "ss_self" on public.saved_searches for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- generic permission policies factory (apply to module entities)
do $$
declare
  rec record;
  cfg text[][] := array[
    -- table, module, entity
    ['partners','core','partners'],
    ['product_uom','products','uom'],
    ['product_categories','products','categories'],
    ['product_attributes','products','attributes'],
    ['product_attribute_values','products','attributes'],
    ['products','products','products'],
    ['product_template_attributes','products','products'],
    ['product_template_attribute_values','products','products'],
    ['product_variants','products','products'],
    ['product_variant_values','products','products'],
    ['product_suppliers','products','products'],
    ['boms','products','bom'],
    ['bom_lines','products','bom'],
    ['bom_operations','products','bom'],
    ['warehouses','inventory','warehouses'],
    ['stock_locations','inventory','locations'],
    ['putaway_rules','inventory','rules'],
    ['stock_lots','inventory','lots'],
    ['stock_quants','inventory','quants'],
    ['stock_pickings','inventory','pickings'],
    ['stock_moves','inventory','pickings'],
    ['reordering_rules','inventory','rules'],
    ['inventory_adjustments','inventory','adjustments'],
    ['inventory_adjustment_lines','inventory','adjustments'],
    ['pricelists','sales','pricelists'],
    ['pricelist_items','sales','pricelists'],
    ['sale_orders','sales','orders'],
    ['sale_order_lines','sales','orders'],
    ['purchase_orders','purchase','orders'],
    ['purchase_order_lines','purchase','orders']
  ];
  i int;
begin
  for i in 1..array_length(cfg,1) loop
    execute format($f$
      create policy "%1$s_view" on public.%1$s for select to authenticated
        using (public.has_permission(auth.uid(),'%2$s'::app_module,'%3$s','view'));
      create policy "%1$s_insert" on public.%1$s for insert to authenticated
        with check (public.has_permission(auth.uid(),'%2$s'::app_module,'%3$s','create'));
      create policy "%1$s_update" on public.%1$s for update to authenticated
        using (public.has_permission(auth.uid(),'%2$s'::app_module,'%3$s','edit'));
      create policy "%1$s_delete" on public.%1$s for delete to authenticated
        using (public.has_permission(auth.uid(),'%2$s'::app_module,'%3$s','delete'));
    $f$, cfg[i][1], cfg[i][2], cfg[i][3]);
  end loop;
end $$;

-- ---------- SEED: installed modules ----------
insert into public.installed_modules (module, installed) values
  ('core', true),('products', true),('sales', true),('purchase', true),('inventory', true)
on conflict (module) do nothing;

-- ---------- SEED: groups ----------
insert into public.groups (code, name, module, description) values
  ('system_admin','Administrador do Sistema','core','Acesso total a todos os módulos'),
  ('products_user','Produtos / Usuário','products','Pode visualizar e editar produtos'),
  ('products_manager','Produtos / Gerente','products','Acesso completo a produtos e BOM'),
  ('sales_user','Vendas / Usuário','sales','Pode criar e gerir suas próprias vendas'),
  ('sales_manager','Vendas / Gerente','sales','Acesso completo a vendas'),
  ('purchase_user','Compras / Usuário','purchase','Pode criar e gerir compras'),
  ('purchase_manager','Compras / Gerente','purchase','Acesso completo a compras'),
  ('inventory_user','Stock / Operador','inventory','Operações de WMS (picking, recebimento)'),
  ('inventory_manager','Stock / Gerente','inventory','Configuração de armazéns e regras')
on conflict (code) do nothing;

-- ---------- SEED: group_permissions (granular CRUD) ----------
do $$
declare
  rec record;
  entities_products text[] := array['products','categories','attributes','uom','bom'];
  entities_sales text[] := array['orders','pricelists'];
  entities_purchase text[] := array['orders'];
  entities_inv_user text[] := array['pickings','lots','quants','adjustments'];
  entities_inv_mgr text[] := array['warehouses','locations','rules','pickings','lots','quants','adjustments'];
  e text;
  g_id uuid;
begin
  -- Products user: view+edit, no delete
  select id into g_id from public.groups where code='products_user';
  foreach e in array entities_products loop
    insert into public.group_permissions(group_id,module,entity,action) values
      (g_id,'products',e,'view'),(g_id,'products',e,'create'),(g_id,'products',e,'edit')
    on conflict do nothing;
  end loop;
  -- Products manager: full
  select id into g_id from public.groups where code='products_manager';
  foreach e in array entities_products loop
    insert into public.group_permissions(group_id,module,entity,action) values
      (g_id,'products',e,'view'),(g_id,'products',e,'create'),(g_id,'products',e,'edit'),
      (g_id,'products',e,'delete'),(g_id,'products',e,'export')
    on conflict do nothing;
  end loop;
  -- Sales user: view+create+edit
  select id into g_id from public.groups where code='sales_user';
  foreach e in array entities_sales loop
    insert into public.group_permissions(group_id,module,entity,action) values
      (g_id,'sales',e,'view'),(g_id,'sales',e,'create'),(g_id,'sales',e,'edit')
    on conflict do nothing;
  end loop;
  insert into public.group_permissions(group_id,module,entity,action)
    select g_id,'core','partners','view' on conflict do nothing;
  insert into public.group_permissions(group_id,module,entity,action)
    select g_id,'core','partners','create' on conflict do nothing;
  insert into public.group_permissions(group_id,module,entity,action)
    select g_id,'products','products','view' on conflict do nothing;
  -- Sales manager: full
  select id into g_id from public.groups where code='sales_manager';
  foreach e in array entities_sales loop
    insert into public.group_permissions(group_id,module,entity,action) values
      (g_id,'sales',e,'view'),(g_id,'sales',e,'create'),(g_id,'sales',e,'edit'),
      (g_id,'sales',e,'delete'),(g_id,'sales',e,'export')
    on conflict do nothing;
  end loop;
  -- Purchase user
  select id into g_id from public.groups where code='purchase_user';
  insert into public.group_permissions(group_id,module,entity,action) values
    (g_id,'purchase','orders','view'),(g_id,'purchase','orders','create'),(g_id,'purchase','orders','edit'),
    (g_id,'core','partners','view'),(g_id,'core','partners','create'),
    (g_id,'products','products','view')
  on conflict do nothing;
  -- Purchase manager
  select id into g_id from public.groups where code='purchase_manager';
  insert into public.group_permissions(group_id,module,entity,action) values
    (g_id,'purchase','orders','view'),(g_id,'purchase','orders','create'),(g_id,'purchase','orders','edit'),
    (g_id,'purchase','orders','delete'),(g_id,'purchase','orders','export'),
    (g_id,'core','partners','view'),(g_id,'core','partners','create'),(g_id,'core','partners','edit')
  on conflict do nothing;
  -- Inventory user
  select id into g_id from public.groups where code='inventory_user';
  foreach e in array entities_inv_user loop
    insert into public.group_permissions(group_id,module,entity,action) values
      (g_id,'inventory',e,'view'),(g_id,'inventory',e,'create'),(g_id,'inventory',e,'edit')
    on conflict do nothing;
  end loop;
  insert into public.group_permissions(group_id,module,entity,action) values
    (g_id,'inventory','warehouses','view'),(g_id,'inventory','locations','view'),(g_id,'inventory','rules','view')
  on conflict do nothing;
  -- Inventory manager
  select id into g_id from public.groups where code='inventory_manager';
  foreach e in array entities_inv_mgr loop
    insert into public.group_permissions(group_id,module,entity,action) values
      (g_id,'inventory',e,'view'),(g_id,'inventory',e,'create'),(g_id,'inventory',e,'edit'),
      (g_id,'inventory',e,'delete'),(g_id,'inventory',e,'export')
    on conflict do nothing;
  end loop;
end $$;

-- ---------- SEED: company, warehouse, locations, uom ----------
insert into public.companies (id, name) values ('00000000-0000-0000-0000-000000000001','UP Móveis')
on conflict (id) do nothing;

insert into public.product_uom (name, code, ratio, category) values
  ('Unidade','un',1,'unit'),('Caixa','cx',12,'unit'),
  ('Quilograma','kg',1,'weight'),('Grama','g',0.001,'weight'),
  ('Metro','m',1,'length'),('Centímetro','cm',0.01,'length')
on conflict (code) do nothing;

insert into public.warehouses (id, name, code, company_id) values
  ('00000000-0000-0000-0000-000000000010','Armazém Principal','WH','00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.stock_locations (warehouse_id, name, type, full_path) values
  ('00000000-0000-0000-0000-000000000010','Stock','internal','WH/Stock'),
  ('00000000-0000-0000-0000-000000000010','Recebimento','internal','WH/Input'),
  ('00000000-0000-0000-0000-000000000010','Qualidade','internal','WH/Quality'),
  ('00000000-0000-0000-0000-000000000010','Expedição','internal','WH/Output'),
  (null,'Fornecedores','supplier','Partners/Vendors'),
  (null,'Clientes','customer','Partners/Customers'),
  (null,'Sucata','inventory_loss','Virtual/Scrap')
on conflict do nothing;
