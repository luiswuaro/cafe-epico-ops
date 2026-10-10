-- MAQUILA: café verde de terceros; no se mezcla con inventario propio ni Loyverse.
-- Datos accesibles únicamente desde servidor autenticado con roast.manage.
CREATE TABLE IF NOT EXISTS roast_contract_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  contact text, phone text, email text, notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roast_contract_clients_org_idx ON public.roast_contract_clients(organization_id);

CREATE TABLE IF NOT EXISTS roast_contract_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.roast_contract_clients(id) ON DELETE RESTRICT,
  coffee_name text NOT NULL CHECK (length(btrim(coffee_name)) >= 2),
  origin text, producer text, variety text, process text,
  green_received_g numeric(12,2) NOT NULL CHECK(green_received_g > 0),
  fee_per_kg_green numeric(12,2) NOT NULL DEFAULT 0 CHECK(fee_per_kg_green >= 0),
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roast_contract_lots_org_client_idx ON public.roast_contract_lots(organization_id,client_id);

CREATE TABLE IF NOT EXISTS roast_contract_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES public.roast_contract_lots(id) ON DELETE RESTRICT,
  batch_code varchar(100) NOT NULL,
  roasted_at timestamptz NOT NULL DEFAULT now(),
  green_g numeric(12,2) NOT NULL CHECK(green_g > 0),
  roasted_g numeric(12,2) NOT NULL CHECK(roasted_g > 0 AND roasted_g <= green_g),
  profile text,
  first_crack_c numeric(7,2),
  drop_c numeric(7,2),
  duration_s integer CHECK(duration_s IS NULL OR duration_s > 0),
  dtr_pct numeric(7,3) CHECK (dtr_pct IS NULL OR (dtr_pct BETWEEN 0 AND 100)),
  green_defect_sample_g numeric(10,2) CHECK(green_defect_sample_g IS NULL OR green_defect_sample_g > 0),
  defects jsonb NOT NULL DEFAULT '[]'::jsonb,
  sensory_notes text,
  quality_notes text,
  source_batch_id uuid REFERENCES public.roast_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roast_contract_batches_code_uidx UNIQUE(lot_id,batch_code),
  CONSTRAINT roast_contract_batches_source_uidx UNIQUE(source_batch_id),
  CONSTRAINT roast_contract_batches_defects_array_chk CHECK (jsonb_typeof(defects)='array')
);
CREATE INDEX IF NOT EXISTS roast_contract_batches_lot_date_idx ON public.roast_contract_batches(lot_id,roasted_at);

CREATE TABLE IF NOT EXISTS roast_contract_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.roast_contract_batches(id) ON DELETE RESTRICT,
  grams numeric(12,2) NOT NULL CHECK(grams > 0),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  recipient text, notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roast_contract_deliveries_batch_idx ON public.roast_contract_deliveries(batch_id);
ALTER TABLE public.roast_contract_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_contract_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_contract_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_contract_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.roast_contract_clients, public.roast_contract_lots, public.roast_contract_batches,
  public.roast_contract_deliveries FROM anon, authenticated;
