-- Alinear el esquema SQL con posPayments (src/infrastructure/db/schema.ts).
-- Se usan en cobros en efectivo, cálculo del cambio y lectura del ticket.
-- Migración aditiva, idempotente: no modifica los pagos existentes.
ALTER TABLE public.pos_payments
  ADD COLUMN IF NOT EXISTS tendered_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS change_amount numeric(14,2);
