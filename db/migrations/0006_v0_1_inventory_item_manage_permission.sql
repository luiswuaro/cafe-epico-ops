insert into permissions(code,description) values
  ('inventory.item.manage','Crear y administrar catálogo interno de inventario')
on conflict(code) do nothing;

insert into role_permissions(role_id,permission_id)
select r.id,p.id
from roles r
join permissions p on p.code='inventory.item.manage'
where r.code='OWNER'
on conflict do nothing;
