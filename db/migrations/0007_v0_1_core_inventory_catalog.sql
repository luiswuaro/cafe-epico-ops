insert into inventory_items (
  organization_id, name, sku, category, canonical_unit, tracking_type, is_active
)
select o.id, v.name, v.sku, v.category, v.unit::canonical_unit, 'QUANTITY', true
from organizations o
cross join (
  values
    ('Leche deslactosada','LECHE-DESL','LÁCTEOS','ml'),
    ('Vaso caliente 12 oz','VASO-CAL-12','EMPAQUE','pz'),
    ('Tapa caliente 12 oz','TAPA-CAL-12','EMPAQUE','pz'),
    ('Fajilla 12 oz','FAJILLA-12','EMPAQUE','pz'),
    ('Vaso frío 16 oz','VASO-FRIO-16','EMPAQUE','pz'),
    ('Tapa plana 16 oz','TAPA-FRIO-16','EMPAQUE','pz'),
    ('Popote','POPOTE','EMPAQUE','pz'),
    ('Servilleta','SERVILLETA','EMPAQUE','pz'),
    ('Hielo','HIELO','HIELO','g'),
    ('Chocolate','CHOCOLATE','BASE','g'),
    ('Leche condensada','LECHE-COND','BASE','g'),
    ('Agua mineral','AGUA-MINERAL','BEBIDAS','ml'),
    ('Agua tónica','AGUA-TONICA','BEBIDAS','ml'),
    ('Jarabe de horchata','JARABE-HORCHATA','JARABES','ml'),
    ('Matcha','MATCHA','POLVOS','g'),
    ('Taro','TARO','POLVOS','g'),
    ('Chai','CHAI','POLVOS','g')
) as v(name, sku, category, unit)
where o.slug='cafe-epico'
on conflict (organization_id, sku) do update
set name=excluded.name,
    category=excluded.category,
    canonical_unit=excluded.canonical_unit,
    is_active=true,
    updated_at=now();
