-- Versionar especificaciones QC de espresso sin alterar controles históricos.
insert into recipe_versions (
  id, organization_id, recipe_id, major_version, minor_version, status,
  yield_quantity, yield_unit, instructions, presentation_spec, quality_spec,
  effective_from, published_at, created_at, updated_at
)
select
  '00000000-0000-4000-8000-000000000083',
  rv.organization_id,
  rv.recipe_id,
  1, 1, 'ACTIVE',
  27, 'g',
  'Dosificar 18 g. Extraer entre ratio 1:1.0 y 1:1.5. Tiempo objetivo 15–25 s. Registrar dosis, yield, tiempo y evaluación sensorial.',
  rv.presentation_spec,
  '{"dose_g":18,"ratio_min":1.0,"ratio_max":1.5,"time_min_s":15,"time_max_s":25}'::jsonb,
  now(), now(), now(), now()
from recipes r
join recipe_versions rv on rv.id=r.current_version_id
where r.name='Ristretto base 1:1'
  and not exists (select 1 from recipe_versions where id='00000000-0000-4000-8000-000000000083');

insert into recipe_versions (
  id, organization_id, recipe_id, major_version, minor_version, status,
  yield_quantity, yield_unit, instructions, presentation_spec, quality_spec,
  effective_from, published_at, created_at, updated_at
)
select
  '00000000-0000-4000-8000-000000000084',
  rv.organization_id,
  rv.recipe_id,
  1, 1, 'ACTIVE',
  36, 'g',
  'Dosificar 18 g. Extraer a ratio 1:2 con tolerancia de ±2 g en yield. Tiempo objetivo 22–35 s. Registrar dosis, yield, tiempo y evaluación sensorial.',
  rv.presentation_spec,
  '{"dose_g":18,"target_ratio":2.0,"yield_tolerance_g":2.0,"time_min_s":22,"time_max_s":35}'::jsonb,
  now(), now(), now(), now()
from recipes r
join recipe_versions rv on rv.id=r.current_version_id
where r.name='Espresso base 1:2'
  and not exists (select 1 from recipe_versions where id='00000000-0000-4000-8000-000000000084');

insert into recipe_versions (
  id, organization_id, recipe_id, major_version, minor_version, status,
  yield_quantity, yield_unit, instructions, presentation_spec, quality_spec,
  effective_from, published_at, created_at, updated_at
)
select
  '00000000-0000-4000-8000-000000000085',
  rv.organization_id,
  rv.recipe_id,
  1, 1, 'ACTIVE',
  45, 'g',
  'Dosificar 18 g. Extraer a ratio 1:2.5 con tolerancia de ±2 g en yield. Tiempo objetivo 30–40 s. Registrar dosis, yield, tiempo y evaluación sensorial.',
  rv.presentation_spec,
  '{"dose_g":18,"target_ratio":2.5,"yield_tolerance_g":2.0,"time_min_s":30,"time_max_s":40}'::jsonb,
  now(), now(), now(), now()
from recipes r
join recipe_versions rv on rv.id=r.current_version_id
where r.name='Lungo base 1:2.5'
  and not exists (select 1 from recipe_versions where id='00000000-0000-4000-8000-000000000085');

insert into recipe_components (
  organization_id, recipe_version_id, inventory_item_id, quantity, waste_factor, sequence, notes
)
select rc.organization_id, '00000000-0000-4000-8000-000000000083', rc.inventory_item_id, rc.quantity, rc.waste_factor, rc.sequence, rc.notes
from recipes r
join recipe_versions oldrv on oldrv.id=r.current_version_id
join recipe_components rc on rc.recipe_version_id=oldrv.id
where r.name='Ristretto base 1:1'
  and not exists (select 1 from recipe_components where recipe_version_id='00000000-0000-4000-8000-000000000083');

insert into recipe_components (
  organization_id, recipe_version_id, inventory_item_id, quantity, waste_factor, sequence, notes
)
select rc.organization_id, '00000000-0000-4000-8000-000000000084', rc.inventory_item_id, rc.quantity, rc.waste_factor, rc.sequence, rc.notes
from recipes r
join recipe_versions oldrv on oldrv.id=r.current_version_id
join recipe_components rc on rc.recipe_version_id=oldrv.id
where r.name='Espresso base 1:2'
  and not exists (select 1 from recipe_components where recipe_version_id='00000000-0000-4000-8000-000000000084');

insert into recipe_components (
  organization_id, recipe_version_id, inventory_item_id, quantity, waste_factor, sequence, notes
)
select rc.organization_id, '00000000-0000-4000-8000-000000000085', rc.inventory_item_id, rc.quantity, rc.waste_factor, rc.sequence, rc.notes
from recipes r
join recipe_versions oldrv on oldrv.id=r.current_version_id
join recipe_components rc on rc.recipe_version_id=oldrv.id
where r.name='Lungo base 1:2.5'
  and not exists (select 1 from recipe_components where recipe_version_id='00000000-0000-4000-8000-000000000085');

update recipe_versions rv
set status='ARCHIVED', effective_until=now(), updated_at=now()
from recipes r
where r.id=rv.recipe_id
  and r.name in ('Ristretto base 1:1','Espresso base 1:2','Lungo base 1:2.5')
  and rv.id not in (
    '00000000-0000-4000-8000-000000000083',
    '00000000-0000-4000-8000-000000000084',
    '00000000-0000-4000-8000-000000000085'
  )
  and rv.status='ACTIVE';

update recipes set current_version_id='00000000-0000-4000-8000-000000000083', updated_at=now()
where name='Ristretto base 1:1';
update recipes set current_version_id='00000000-0000-4000-8000-000000000084', updated_at=now()
where name='Espresso base 1:2';
update recipes set current_version_id='00000000-0000-4000-8000-000000000085', updated_at=now()
where name='Lungo base 1:2.5';
