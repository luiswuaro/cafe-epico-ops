-- OPS print station: replace append-only, high-frequency audit heartbeats
-- with one current-state record per store. Keep all historical audit events
-- for diagnostics and keep CLAIM/DONE/FAILED/EXPIRED job events unchanged.
CREATE TABLE IF NOT EXISTS public.pos_print_station_status (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  station_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  bridge_ready boolean NOT NULL DEFAULT false,
  last_seen timestamptz NOT NULL DEFAULT now()
) WITH (fillfactor = 80);

ALTER TABLE public.pos_print_station_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.pos_print_station_status FROM anon, authenticated;
COMMENT ON TABLE public.pos_print_station_status IS
  'Private, mutable OPS print-station heartbeat: one row per store. Print jobs remain immutable in audit_events.';
