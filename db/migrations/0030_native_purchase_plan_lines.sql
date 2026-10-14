-- Native OPS purchase plans: preserve historic variant_external_id for old plans.
-- New plans point directly to inventory_items. Additive, no legacy data rewrite.
ALTER TABLE public.purchase_plan_lines
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid
  REFERENCES public.inventory_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS purchase_plan_lines_native_item_idx
  ON public.purchase_plan_lines (organization_id, inventory_item_id);
