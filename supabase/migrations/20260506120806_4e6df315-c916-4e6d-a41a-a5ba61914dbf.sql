
-- ACTIVITIES
create table if not exists public.record_activities (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  record_id uuid not null,
  activity_type text not null default 'todo',
  summary text not null,
  note text,
  due_date date,
  assigned_to uuid,
  created_by uuid,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists idx_record_activities_record on public.record_activities(record_type, record_id);
create index if not exists idx_record_activities_assignee on public.record_activities(assigned_to, state);
alter table public.record_activities enable row level security;
create policy ra_read on public.record_activities for select to authenticated using (true);
create policy ra_insert on public.record_activities for insert to authenticated with check (created_by = auth.uid());
create policy ra_update on public.record_activities for update to authenticated using (created_by = auth.uid() or assigned_to = auth.uid() or has_group(auth.uid(),'system_admin'));
create policy ra_delete on public.record_activities for delete to authenticated using (created_by = auth.uid() or has_group(auth.uid(),'system_admin'));

-- DISCUSS - members first
create table if not exists public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'channel',
  description text,
  is_private boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.chat_channel_members (
  channel_id uuid not null,
  user_id uuid not null,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null,
  author_id uuid not null,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_msgs_channel on public.chat_messages(channel_id, created_at desc);

alter table public.chat_channels enable row level security;
alter table public.chat_channel_members enable row level security;
alter table public.chat_messages enable row level security;

create policy cc_read on public.chat_channels for select to authenticated using (
  not is_private or exists (select 1 from public.chat_channel_members m where m.channel_id = id and m.user_id = auth.uid())
);
create policy cc_insert on public.chat_channels for insert to authenticated with check (created_by = auth.uid());
create policy cc_update on public.chat_channels for update to authenticated using (created_by = auth.uid() or has_group(auth.uid(),'system_admin'));
create policy cc_delete on public.chat_channels for delete to authenticated using (created_by = auth.uid() or has_group(auth.uid(),'system_admin'));

create policy ccm_read on public.chat_channel_members for select to authenticated using (true);
create policy ccm_insert on public.chat_channel_members for insert to authenticated with check (user_id = auth.uid() or has_group(auth.uid(),'system_admin'));
create policy ccm_update on public.chat_channel_members for update to authenticated using (user_id = auth.uid());
create policy ccm_delete on public.chat_channel_members for delete to authenticated using (user_id = auth.uid() or has_group(auth.uid(),'system_admin'));

create policy cm_read on public.chat_messages for select to authenticated using (true);
create policy cm_insert on public.chat_messages for insert to authenticated with check (author_id = auth.uid());
create policy cm_update on public.chat_messages for update to authenticated using (author_id = auth.uid());
create policy cm_delete on public.chat_messages for delete to authenticated using (author_id = auth.uid() or has_group(auth.uid(),'system_admin'));

alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.record_activities;

create or replace function public.fn_notify_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid; ch text;
begin
  select name into ch from public.chat_channels where id = new.channel_id;
  foreach uid in array new.mentions loop
    insert into public.notifications(user_id, module, type, title, body, link)
    values (uid, 'sales','mention','Mencionado em #' || coalesce(ch,'canal'),
            left(new.body, 200), '/discuss/' || new.channel_id);
  end loop;
  return new;
end $$;
drop trigger if exists trg_notify_mentions on public.chat_messages;
create trigger trg_notify_mentions after insert on public.chat_messages
for each row execute function public.fn_notify_mentions();

-- HR
create table if not exists public.hr_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null, manager_id uuid, parent_id uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, full_name text not null, email text, phone text,
  job_title text, department_id uuid, manager_id uuid,
  hire_date date, birth_date date, active boolean not null default true,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.hr_attendances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  check_in timestamptz not null default now(),
  check_out timestamptz, worked_hours numeric, notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_hr_att_emp on public.hr_attendances(employee_id, check_in desc);
create table if not exists public.hr_leaves (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  type text not null default 'vacation',
  start_date date not null, end_date date not null,
  reason text, state text not null default 'draft',
  approver_id uuid,
  created_at timestamptz not null default now()
);

alter table public.hr_departments enable row level security;
alter table public.hr_employees enable row level security;
alter table public.hr_attendances enable row level security;
alter table public.hr_leaves enable row level security;

create policy hrd_read on public.hr_departments for select to authenticated using (true);
create policy hrd_admin on public.hr_departments for all to authenticated using (has_group(auth.uid(),'system_admin')) with check (has_group(auth.uid(),'system_admin'));

create policy hre_read on public.hr_employees for select to authenticated using (true);
create policy hre_admin on public.hr_employees for all to authenticated using (has_group(auth.uid(),'system_admin')) with check (has_group(auth.uid(),'system_admin'));
create policy hre_self_update on public.hr_employees for update to authenticated using (user_id = auth.uid());

create policy hra_read on public.hr_attendances for select to authenticated using (
  has_group(auth.uid(),'system_admin') or exists(select 1 from public.hr_employees e where e.id=employee_id and e.user_id=auth.uid())
);
create policy hra_self on public.hr_attendances for insert to authenticated with check (
  exists(select 1 from public.hr_employees e where e.id=employee_id and e.user_id=auth.uid())
);
create policy hra_self_update on public.hr_attendances for update to authenticated using (
  exists(select 1 from public.hr_employees e where e.id=employee_id and e.user_id=auth.uid()) or has_group(auth.uid(),'system_admin')
);

create policy hrl_read on public.hr_leaves for select to authenticated using (
  has_group(auth.uid(),'system_admin') or exists(select 1 from public.hr_employees e where e.id=employee_id and e.user_id=auth.uid())
);
create policy hrl_self on public.hr_leaves for insert to authenticated with check (
  exists(select 1 from public.hr_employees e where e.id=employee_id and e.user_id=auth.uid())
);
create policy hrl_update on public.hr_leaves for update to authenticated using (
  has_group(auth.uid(),'system_admin') or exists(select 1 from public.hr_employees e where e.id=employee_id and e.user_id=auth.uid())
);

drop trigger if exists trg_hre_updated on public.hr_employees;
create trigger trg_hre_updated before update on public.hr_employees for each row execute function public.tg_set_updated_at();

create extension if not exists pg_cron;
create extension if not exists pg_net;
