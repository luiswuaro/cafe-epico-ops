-- QA / POS: cada cuenta dividida puede liquidarse con puntos y dinero.
-- La restricción inicial (0023) permitía sólo UN pago por split y hacía
-- fallar un cobro legítimo POINTS + CASH/CARD/TRANSFER.
--
-- Mantener idempotencia: máximo una entrada POINTS y una monetaria por split,
-- sin duplicar el importe si dos celulares intentan cobrar al mismo tiempo.
-- Los cobros sin split conservan su esquema y su lógica transaccional actual.
DROP INDEX IF EXISTS public.pos_payments_split_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_split_points_once_uidx
  ON public.pos_payments(split_id)
  WHERE split_id IS NOT NULL AND method = 'POINTS';

CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_split_monetary_once_uidx
  ON public.pos_payments(split_id)
  WHERE split_id IS NOT NULL AND method <> 'POINTS';

CREATE INDEX IF NOT EXISTS pos_payments_split_lookup_idx
  ON public.pos_payments(split_id)
  WHERE split_id IS NOT NULL;

COMMENT ON INDEX public.pos_payments_split_points_once_uidx IS
  'Máximo un canje de puntos por cuenta dividida; compatible con cobro monetario adicional.';
COMMENT ON INDEX public.pos_payments_split_monetary_once_uidx IS
  'Máximo un cobro monetario por cuenta dividida; duplicados se bloquean en PostgreSQL.';
