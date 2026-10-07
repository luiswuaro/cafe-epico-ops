alter table operational_events
  alter column quantity type numeric(18,6);

alter table operational_events
  add column if not exists display_quantity numeric(18,3);

alter table operational_events
  add column if not exists display_unit varchar(20);
