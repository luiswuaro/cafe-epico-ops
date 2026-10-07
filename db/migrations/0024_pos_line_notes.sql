-- POS v0.1.4: notas por unidad/producto en comandas.

alter table public.pos_order_lines
  add column if not exists note text;
