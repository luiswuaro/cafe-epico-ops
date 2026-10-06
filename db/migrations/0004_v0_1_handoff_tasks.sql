with target as (
  select ct.id as template_id, ct.organization_id
  from checklist_templates ct
  where ct.shift_type='HANDOFF'
    and ct.name='Entrega de turno'
  limit 1
),
barista as (
  select r.id as role_id, r.organization_id
  from roles r
  where r.code='BARISTA'
  limit 1
),
seed(title, description, area, priority, is_required, sort_order, input_type) as (
  values
    ('Dejar barra abastecida','Confirmar leche, café, vasos, tapas, jarabes, polvos y consumibles para el siguiente turno.','Barra','HANDOFF_CRITICAL',true,10,'BOOLEAN'),
    ('Dejar barra limpia y utensilios listos','Lavar, secar y acomodar utensilios; limpiar superficies de trabajo.','Limpieza','HANDOFF_CRITICAL',true,20,'BOOLEAN'),
    ('Reportar estado de espresso y molino','Anotar cualquier desviación, ajuste pendiente, alarma, ruido o condición relevante. Si todo está normal, registrar "Sin novedad".','Espresso','HANDOFF_CRITICAL',true,30,'TEXT'),
    ('Reportar faltantes y compras pendientes','Registrar faltantes detectados. Si no hay faltantes, registrar "Sin faltantes".','Inventario','HANDOFF_CRITICAL',true,40,'TEXT'),
    ('Reportar caducidades e incidencias del turno','Registrar producto próximo a caducar, merma, error, equipo o evento relevante. Si no hubo, registrar "Sin incidencias".','Operación','HANDOFF_CRITICAL',true,50,'TEXT'),
    ('Registrar corte de caja del turno','Capturar el monto del corte/entrega de caja en MXN.','Caja','HANDOFF_CRITICAL',true,60,'NUMBER')
)
insert into checklist_tasks (
  organization_id, checklist_template_id, title, description, area, priority,
  is_required, sort_order, input_type, assigned_role_id, config
)
select
  t.organization_id, t.template_id, s.title, s.description, s.area, s.priority,
  s.is_required, s.sort_order, s.input_type::checklist_input_type, b.role_id, '{}'::jsonb
from target t
cross join seed s
left join barista b on b.organization_id=t.organization_id
where not exists (
  select 1
  from checklist_tasks existing
  where existing.checklist_template_id=t.template_id
    and existing.title=s.title
);
