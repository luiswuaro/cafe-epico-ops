-- P0 security hardening for three public-schema tables historically created without RLS.
-- OPS accesses these exclusively from server-side PostgreSQL with application RBAC.
-- No user-facing Data API access is needed; preserve all rows and server grants.
ALTER TABLE public.operational_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyverse_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyverse_inventory_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.operational_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.loyverse_categories FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.loyverse_inventory_snapshots FROM anon, authenticated;
