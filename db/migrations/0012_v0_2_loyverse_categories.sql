create table if not exists loyverse_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_id text not null,
  name text not null,
  payload jsonb not null,
  external_updated_at timestamptz,
  synced_at timestamptz not null default now()
);

create unique index if not exists loyverse_categories_external_uidx
  on loyverse_categories(organization_id, external_id);
