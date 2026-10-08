-- POS v0.1.5: plantilla editable de ticket y logo térmico.

insert into public.permissions(code, description) values
  ('pos.print.manage','Configurar impresora y plantilla térmica')
on conflict(code) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'OWNER'
  and p.code = 'pos.print.manage'
on conflict do nothing;

create table if not exists pos_print_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_name text not null default 'Café Épico',
  address_line text not null default 'Tepexi de Rodríguez, Puebla',
  phone_line text,
  social_line text,
  header_message text,
  footer_message text not null default 'Gracias por tu visita.',
  show_logo boolean not null default false,
  logo_data_url text,
  logo_raster_base64 text,
  logo_width_px integer,
  logo_height_px integer,
  logo_align varchar(20) not null default 'center',
  show_business_name boolean not null default true,
  show_address boolean not null default true,
  show_phone boolean not null default false,
  show_social boolean not null default false,
  show_folio boolean not null default true,
  show_date boolean not null default true,
  show_employee boolean not null default true,
  show_service boolean not null default true,
  show_customer boolean not null default true,
  show_points boolean not null default true,
  show_item_notes boolean not null default true,
  show_no_cfdi boolean not null default true,
  line_width_chars integer not null default 32,
  feed_lines integer not null default 3,
  auto_cut boolean not null default false,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pos_print_settings_org_uidx
  on public.pos_print_settings(organization_id);

insert into public.pos_print_settings(organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

alter table public.pos_print_settings enable row level security;
revoke all on table public.pos_print_settings from anon, authenticated;
