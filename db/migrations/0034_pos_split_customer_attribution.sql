-- Cliente que realmente paga CADA cuenta, no el cliente global de la mesa.
-- Usar FK explícita evita adivinarlo a partir de textos de recibo/puntos.
-- Las cuentas anteriores quedan sin atribución si no existe evidencia inequívoca;
-- jamás adjudicar automáticamente la compra de una mesa a un solo cliente.
ALTER TABLE public.pos_order_splits
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.pos_customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pos_order_splits_customer_paid_idx
  ON public.pos_order_splits(customer_id,paid_at DESC)
  WHERE customer_id IS NOT NULL AND status='PAID';

COMMENT ON COLUMN public.pos_order_splits.customer_id IS
  'Cliente vinculado a esta cuenta al pagar; no altera el cliente original de la mesa.';
