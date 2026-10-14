
-- OPS sustituye la reconstrucción permanente desde las tablas históricas de Loyverse.
-- Snapshot no destructivo: mantiene los IDs/JSON importados para compatibilidad de
-- recetas y tickets existentes. Las ediciones de precio, recetas e inventario
-- continúan en las tablas OPS nativas, fuera de este snapshot.
CREATE TABLE IF NOT EXISTS public.ops_catalog_archive_snapshots (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings jsonb NOT NULL DEFAULT '[]'::jsonb,
  popularity jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ops_catalog_archive_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ops_catalog_archive_snapshots FROM anon, authenticated;
COMMENT ON TABLE public.ops_catalog_archive_snapshots IS
  'Copia de compatibilidad del catálogo migrado a OPS; no sincroniza Loyverse. Solo lectura del backend.';

INSERT INTO public.ops_catalog_archive_snapshots
  (organization_id,items,variants,categories,settings,popularity)
SELECT o.id,
 COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'externalId',i.external_id,'itemName',i.item_name,'payload',i.payload
   ) ORDER BY i.external_id)
   FROM public.loyverse_items i WHERE i.organization_id=o.id AND i.deleted_at IS NULL
 ),'[]'::jsonb),
 COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'externalId',v.external_id,'loyverseItemExternalId',v.loyverse_item_external_id,
     'variantName',v.variant_name,'sku',v.sku,'payload',v.payload
   ) ORDER BY v.external_id)
   FROM public.loyverse_variants v WHERE v.organization_id=o.id
 ),'[]'::jsonb),
 COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'externalId',c.external_id,'name',c.name
   ) ORDER BY c.external_id)
   FROM public.loyverse_categories c WHERE c.organization_id=o.id
 ),'[]'::jsonb),
 COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'variantExternalId',s.variant_external_id,'displayUnit',s.display_unit,
     'displayFactor',s.display_factor,'unitCostOverride',s.unit_cost_override,
     'packagePrice',s.package_price,'packageQuantityNative',s.package_quantity_native
   ) ORDER BY s.variant_external_id)
   FROM public.loyverse_item_settings s WHERE s.organization_id=o.id
 ),'[]'::jsonb),
 COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'itemName',x.item_name,'units',x.units
   ) ORDER BY x.item_name)
   FROM (
      SELECT (rl.payload->>'item_name') AS item_name,
        sum(rl.quantity)::text AS units
      FROM public.loyverse_receipt_lines rl
      JOIN public.loyverse_receipts r
        ON r.organization_id=rl.organization_id
       AND r.external_id=rl.receipt_external_id
      WHERE rl.organization_id=o.id
        AND r.receipt_type='SALE'
        AND r.receipt_date>=now()-interval '30 days'
        AND coalesce(r.payload->>'cancelled_at','')=''
      GROUP BY rl.payload->>'item_name'
   ) x
 ),'[]'::jsonb)
FROM public.organizations o
WHERE EXISTS (SELECT 1 FROM public.loyverse_items i WHERE i.organization_id=o.id)
ON CONFLICT(organization_id) DO NOTHING;
