-- Editable operational financial assumptions shared across authorized devices.
-- Neither expenses nor their PAID flag are bank-confirmed financial transactions.
CREATE TABLE IF NOT EXISTS financial_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expenses jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(expenses)='array' AND jsonb_array_length(expenses)<=100),
  variable_ratio numeric(6,2) NOT NULL DEFAULT 30 CHECK(variable_ratio BETWEEN 10 AND 75),
  card_rate numeric(6,2) NOT NULL DEFAULT 3.5 CHECK(card_rate BETWEEN 0 AND 30),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  updated_by_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_budgets_org_uidx UNIQUE (organization_id)
);
ALTER TABLE public.financial_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_budgets FROM anon, authenticated;
