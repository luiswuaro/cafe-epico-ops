-- Café Épico Ops V0.1 deterministic seed
-- Safe to re-run. Auth users are linked separately after creation in Supabase Auth.

insert into organizations(id,name,slug,currency_code,timezone) values
('00000000-0000-4000-8000-000000000001','Café Épico','cafe-epico','MXN','America/Mexico_City')
on conflict do nothing;

insert into stores(id,organization_id,name,code,store_type,timezone) values
('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','Café Épico Tepexi','TEPEXI','CAFE','America/Mexico_City')
on conflict do nothing;

insert into inventory_locations(id,organization_id,store_id,name,location_type) values
('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Barra','BAR'),
('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Refrigerador barra','COLD'),
('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Almacén seco','STORAGE')
on conflict do nothing;

insert into permissions(code,description) values
('admin.access','Acceso al panel administrativo'),
('checklist.execute','Ejecutar checklists'),
('checklist.manage','Administrar checklists'),
('recipe.read','Consultar recetas vigentes'),
('recipe.manage','Crear y publicar versiones de receta'),
('recipe.cost.read','Consultar costos y COGS'),
('sop.read','Consultar SOPs'),
('sop.manage','Administrar SOPs'),
('inventory.read','Consultar inventario operativo'),
('inventory.count','Registrar conteos físicos'),
('inventory.waste','Registrar merma'),
('inventory.adjust','Aprobar ajustes administrativos'),
('financial.read','Consultar información financiera'),
('integration.read','Consultar estado de integraciones'),
('integration.manage','Configurar integraciones'),
('pos.sell','Registrar ventas en el POS'),
('pos.mirror.read','Comparar ventas espejo contra Loyverse'),
('pos.cancel','Cancelar cuentas y tickets del POS'),
('pos.catalog.manage','Administrar productos y recetas del POS'),
('pos.cash.manage','Abrir, operar y cerrar la caja de efectivo'),
('pos.print.manage','Configurar impresora y plantilla térmica')
on conflict(code) do nothing;

insert into roles(id,organization_id,code,name,description,is_system_role) values
('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001','OWNER','Dueño','Administración completa',true),
('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001','BARISTA','Barista','Operación de barra',true)
on conflict do nothing;

insert into role_permissions(role_id,permission_id)
select '00000000-0000-4000-8000-000000000030',id from permissions
on conflict do nothing;

insert into role_permissions(role_id,permission_id)
select '00000000-0000-4000-8000-000000000031',id from permissions
where code in ('checklist.execute','recipe.read','sop.read','inventory.read','inventory.count','inventory.waste','pos.sell','pos.mirror.read','pos.cash.manage')
on conflict do nothing;

insert into employees(id,organization_id,home_store_id,name,is_active) values
('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Azucena',true),
('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Propietario principal',true)
on conflict do nothing;

insert into employee_roles(employee_id,role_id,store_id) values
('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000010'),
('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010')
on conflict do nothing;

insert into checklist_templates(id,organization_id,store_id,name,shift_type) values
('00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Apertura','MORNING'),
('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Entrega de turno','HANDOFF')
on conflict do nothing;

insert into checklist_tasks(
  organization_id,checklist_template_id,title,area,priority,is_required,sort_order,input_type,assigned_role_id,config
)
select * from (values
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Abrir puerta principal, canceles y ventana','Apertura','OPENING_CRITICAL',true,10,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Encender letrero LED y tira LED de escaleras','Apertura','OPENING_CRITICAL',true,20,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Encender SAB Jolly en paso 1','Espresso','OPENING_CRITICAL',true,30,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Purgar ambos grupos hasta confirmar flujo continuo','Espresso','OPENING_CRITICAL',true,40,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Activar paso 2 / resistencia','Espresso','OPENING_CRITICAL',true,50,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Encender máquina de hielo y PC/POS','Apertura','OPENING_CRITICAL',true,60,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Abrir turno/caja en Loyverse y registrar fondo real','Caja','OPENING_CRITICAL',true,70,'NUMBER'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{"unit":"MXN"}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Verificar mise en place de barra','Barra','OPENING_CRITICAL',true,80,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Preparar espresso de control','Calidad','OPENING_CRITICAL',true,90,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{"module":"espresso_quality_check"}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Revisar vasos, leches, tapas, jarabes, polvos y café','Inventario','OPENING_CRITICAL',true,100,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Regar cafetos','Limpieza','NORMAL',true,200,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{"frequency":"daily"}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Lavar trapos de limpieza/barra','Limpieza','NORMAL',true,210,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{"frequency":"daily"}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Limpiar refrigeradores','Limpieza','NORMAL',true,220,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{"frequency":"weekly","day":"FR"}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Regar demás plantas','Limpieza','NORMAL',true,230,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{"frequency":"interval_days","interval":3}'::jsonb),
('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'Limpiar vidrios de canceles','Limpieza','NORMAL',true,240,'BOOLEAN'::checklist_input_type,'00000000-0000-4000-8000-000000000031'::uuid,'{"frequency":"interval_days","interval":15}'::jsonb)
) v(organization_id,checklist_template_id,title,area,priority,is_required,sort_order,input_type,assigned_role_id,config)
where not exists (
  select 1 from checklist_tasks t
  where t.checklist_template_id=v.checklist_template_id and t.title=v.title
);

insert into checklist_task_schedules(organization_id,checklist_task_id,rrule,start_date,timezone)
select organization_id,id,
case title
 when 'Regar cafetos' then 'FREQ=DAILY'
 when 'Lavar trapos de limpieza/barra' then 'FREQ=DAILY'
 when 'Limpiar refrigeradores' then 'FREQ=WEEKLY;BYDAY=FR'
 when 'Regar demás plantas' then 'FREQ=DAILY;INTERVAL=3'
 when 'Limpiar vidrios de canceles' then 'FREQ=DAILY;INTERVAL=15'
end,
case when title='Limpiar refrigeradores'
 then '2026-10-02T08:00:00-06:00'::timestamptz
 else '2026-10-01T08:00:00-06:00'::timestamptz end,
'America/Mexico_City'
from checklist_tasks t
where title in ('Regar cafetos','Lavar trapos de limpieza/barra','Limpiar refrigeradores','Regar demás plantas','Limpiar vidrios de canceles')
and not exists(select 1 from checklist_task_schedules s where s.checklist_task_id=t.id);

insert into integration_connections(organization_id,provider,status)
values ('00000000-0000-4000-8000-000000000001','LOYVERSE','DISCONNECTED')
on conflict do nothing;

insert into inventory_items(id,organization_id,name,sku,category,canonical_unit,tracking_type,is_active) values
('00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000001','Café espresso en grano','CAFE-ESPRESSO','CAFÉ','g','QUANTITY',true)
on conflict do nothing;

insert into recipes(id,organization_id,name,is_active) values
('00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000001','Ristretto base 1:1',true),
('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000001','Espresso base 1:2',true),
('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000001','Lungo base 1:2.5',true)
on conflict do nothing;

insert into recipe_versions(
 id,organization_id,recipe_id,major_version,minor_version,status,yield_quantity,yield_unit,instructions,quality_spec,effective_from,published_at
) values
('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000070',1,0,'ACTIVE',18,'g','Dosificar 18 g. Extraer hasta 18 g en taza. Registrar tiempo y evaluación sensorial.','{"dose_g":18,"ratio":1,"time_min_s":22,"time_max_s":35}','2026-10-01T00:00:00-06:00',now()),
('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000071',1,0,'ACTIVE',36,'g','Dosificar 18 g. Extraer hasta 36 g en taza. Registrar tiempo y evaluación sensorial.','{"dose_g":18,"ratio":2,"time_min_s":22,"time_max_s":35}','2026-10-01T00:00:00-06:00',now()),
('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000072',1,0,'ACTIVE',45,'g','Dosificar 18 g. Extraer hasta 45 g en taza. Registrar tiempo y evaluación sensorial.','{"dose_g":18,"ratio":2.5,"time_min_s":22,"time_max_s":35}','2026-10-01T00:00:00-06:00',now())
on conflict do nothing;

update recipes set current_version_id='00000000-0000-4000-8000-000000000080' where id='00000000-0000-4000-8000-000000000070';
update recipes set current_version_id='00000000-0000-4000-8000-000000000081' where id='00000000-0000-4000-8000-000000000071';
update recipes set current_version_id='00000000-0000-4000-8000-000000000082' where id='00000000-0000-4000-8000-000000000072';

insert into recipe_components(organization_id,recipe_version_id,inventory_item_id,quantity,waste_factor,sequence,notes)
select '00000000-0000-4000-8000-000000000001',v.id,'00000000-0000-4000-8000-000000000060',18,0,1,
'Merma técnica pendiente de parametrizar con dato operativo validado.'
from recipe_versions v
where v.id in (
'00000000-0000-4000-8000-000000000080',
'00000000-0000-4000-8000-000000000081',
'00000000-0000-4000-8000-000000000082'
)
and not exists(select 1 from recipe_components c where c.recipe_version_id=v.id);

insert into sops(id,organization_id,title,category,is_active) values
('00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000001','Espresso de control de apertura','ESPRESSO',true),
('00000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000001','Encendido y purga de SAB Jolly','EQUIPO',true)
on conflict do nothing;

insert into sop_versions(id,organization_id,sop_id,major_version,minor_version,status,content,effective_from) values
('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000090',1,0,'ACTIVE','1. Pesar dosis. 2. Ejecutar la extracción correspondiente. 3. Pesar yield. 4. Registrar tiempo. 5. Probar sensorialmente. 6. Si el tiempo está fuera de 22–35 s, reportar y seguir el SOP de calibración según nivel de autorización.','2026-10-01T00:00:00-06:00'),
('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000092',1,0,'ACTIVE','1. Encender paso 1. 2. Purgar ambos grupos para sacar aire de la bomba. 3. Confirmar flujo continuo. 4. Activar paso 2 / resistencia. 5. Permitir calentamiento mientras se prepara barra.','2026-10-01T00:00:00-06:00')
on conflict do nothing;

update sops set current_version_id='00000000-0000-4000-8000-000000000091' where id='00000000-0000-4000-8000-000000000090';
update sops set current_version_id='00000000-0000-4000-8000-000000000093' where id='00000000-0000-4000-8000-000000000092';

update checklist_tasks set sop_id='00000000-0000-4000-8000-000000000090'
where checklist_template_id='00000000-0000-4000-8000-000000000050'
and title='Preparar espresso de control';

update checklist_tasks set sop_id='00000000-0000-4000-8000-000000000092'
where checklist_template_id='00000000-0000-4000-8000-000000000050'
and title in ('Encender SAB Jolly en paso 1','Purgar ambos grupos hasta confirmar flujo continuo','Activar paso 2 / resistencia');
