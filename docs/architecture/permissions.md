# RBAC V0.1

## OWNER

Acceso completo a permisos de V0.1, incluyendo administración, costos, ajustes, finanzas e integraciones.

## BARISTA

- checklist.execute
- recipe.read
- sop.read
- inventory.read
- inventory.count
- inventory.waste

No puede editar recetas publicadas, leer costos, aprobar ajustes ni configurar Loyverse.

La asignación es `employee -> employee_roles -> role_permissions -> permissions`. El rol puede limitarse a una sucursal mediante `employee_roles.store_id`.
