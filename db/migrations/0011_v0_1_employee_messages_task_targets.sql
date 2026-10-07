-- Notas operativas a colaboradores + objetivos de tiempo por tarea.

alter table public.checklist_tasks
  add column if not exists target_duration_seconds integer;

alter table public.checklist_run_tasks
  add column if not exists target_duration_seconds_snapshot integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checklist_tasks_target_duration_positive'
  ) then
    alter table public.checklist_tasks
      add constraint checklist_tasks_target_duration_positive
      check (target_duration_seconds is null or target_duration_seconds > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'checklist_run_tasks_target_duration_positive'
  ) then
    alter table public.checklist_run_tasks
      add constraint checklist_run_tasks_target_duration_positive
      check (
        target_duration_seconds_snapshot is null
        or target_duration_seconds_snapshot > 0
      );
  end if;
end $$;

create table if not exists employee_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  recipient_employee_id uuid not null references public.employees(id) on delete cascade,
  sender_employee_id uuid references public.employees(id) on delete set null,
  title text not null,
  body text not null,
  priority varchar(20) not null default 'NORMAL',
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_messages_recipient_idx
  on public.employee_messages(recipient_employee_id, read_at, created_at desc);

create index if not exists employee_messages_org_idx
  on public.employee_messages(organization_id, created_at desc);

-- Esta tabla solo se usa desde el servidor por Drizzle. No se expone de forma
-- directa a clientes anon/authenticated de Supabase.
alter table public.employee_messages enable row level security;
revoke all on table public.employee_messages from anon, authenticated;
