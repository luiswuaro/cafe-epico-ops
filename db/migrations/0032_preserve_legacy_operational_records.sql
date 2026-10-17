-- Preservación, no reactivación de Loyverse.
-- Estas tres tablas existen en Supabase comercial fuera del repositorio original.
-- En la auditoría read-only de 16-17/oct/2026:
--   operational_inventory_balances: 61 registros
--   operational_inventory_movements: 61 registros
--   financial_budgets: 0 registros
-- Se crean sólo en réplicas nuevas. NO importar sus filas desde producción
-- sin respaldo cifrado y validación de FK/restauración.
CREATE TABLE IF NOT EXISTS public.financial_budgets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 expenses jsonb NOT NULL DEFAULT '[]'::jsonb
   CHECK (jsonb_typeof(expenses)='array' AND jsonb_array_length(expenses)<=100),
 variable_ratio numeric(6,2) NOT NULL DEFAULT 30
   CHECK (variable_ratio>=10 AND variable_ratio<=75),
 card_rate numeric(6,2) NOT NULL DEFAULT 3.5
   CHECK (card_rate>=0 AND card_rate<=30),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
 updated_by_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT financial_budgets_org_uidx UNIQUE (organization_id)
);

CREATE TABLE IF NOT EXISTS public.operational_inventory_balances (
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
 loyverse_store_external_id text NOT NULL,
 variant_external_id text NOT NULL,
 item_name_snapshot text NOT NULL,
 quantity_native numeric(18,6) NOT NULL,
 source_quantity_native numeric(18,6) NOT NULL,
 source_synced_at timestamptz,
 initialized_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (store_id,variant_external_id)
);
CREATE INDEX IF NOT EXISTS operational_inventory_balances_variant_idx
 ON public.operational_inventory_balances(organization_id,variant_external_id);

CREATE TABLE IF NOT EXISTS public.operational_inventory_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
 variant_external_id text NOT NULL,
 item_name_snapshot text NOT NULL,
 movement_type varchar(40) NOT NULL,
 quantity_delta_native numeric(18,6) NOT NULL,
 source_type varchar(40) NOT NULL,
 source_id text,
 order_id uuid REFERENCES public.pos_orders(id) ON DELETE SET NULL,
 employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS operational_inventory_movements_source_uidx
 ON public.operational_inventory_movements
 (organization_id,source_type,source_id,variant_external_id)
 WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operational_inventory_movements_variant_idx
 ON public.operational_inventory_movements
 (organization_id,store_id,variant_external_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS operational_inventory_movements_order_idx
 ON public.operational_inventory_movements(order_id);

ALTER TABLE public.financial_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_inventory_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.financial_budgets FROM anon,authenticated;
REVOKE ALL ON TABLE public.operational_inventory_balances FROM anon,authenticated;
REVOKE ALL ON TABLE public.operational_inventory_movements FROM anon,authenticated;
COMMENT ON TABLE public.operational_inventory_movements IS
 'Legacy operational movement history, retained for migration/reconciliation; not the active native inventory ledger.';
