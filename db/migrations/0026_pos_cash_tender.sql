-- POS v0.2.0: efectivo recibido y cambio calculado por cobro.

alter table public.pos_payments
  add column if not exists tendered_amount numeric(14,2),
  add column if not exists change_amount numeric(14,2);

alter table public.pos_payments
  drop constraint if exists pos_payments_cash_tender_check;

alter table public.pos_payments
  add constraint pos_payments_cash_tender_check
  check (
    (method <> 'CASH' and tendered_amount is null and change_amount is null)
    or
    (
      method = 'CASH'
      and tendered_amount is not null
      and change_amount is not null
      and tendered_amount >= amount
      and change_amount = tendered_amount - amount
    )
  ) not valid;
