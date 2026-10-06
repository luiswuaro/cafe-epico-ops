# Arquitectura V0.1

## Modular monolith

V0.1 usa una sola aplicación Next.js desplegable, pero separa dominio, aplicación e infraestructura. La intención es evitar la complejidad prematura de microservicios y conservar una ruta limpia para extraer procesos (sync, producción, tostado) cuando exista carga real que lo justifique.

```text
app/                       UI + route handlers
src/domain/                reglas puras
src/application/           casos de uso
src/infrastructure/db/     PostgreSQL / Drizzle
src/infrastructure/auth/   Supabase Auth
src/infrastructure/loyverse/ API/Webhook adapter
```

## Límites de confianza

El navegador nunca recibe `LOYVERSE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` o `CRON_SECRET`.

Los usuarios se autentican mediante Supabase Auth. Autorización de negocio se resuelve con RBAC en PostgreSQL. La seguridad no depende únicamente de ocultar botones.

## Multi-sucursal

`organization_id` identifica Café Épico. `store_id` identifica sucursal/unidad operativa. `inventory_location` identifica la ubicación física dentro de una sucursal. Una futura tostaduría puede ser otro `store` con ubicaciones propias.

## Inventario

`inventory_movements` es el ledger. No se actualiza un stock histórico: cada evento agrega un delta.

`inventory_balances` es una proyección materializada para lecturas rápidas. Puede reconstruirse sumando el ledger.

`inventory_counts` captura un conteo físico. La desviación es:

```text
physical_quantity - theoretical_quantity_snapshot
```

Si un dueño aprueba un ajuste, se crea un movimiento `COUNT_ADJUSTMENT`; no se modifica el conteo ni se reescribe la historia.

## Recetas

Una receta publicada no se edita. Se crea una nueva `recipe_version`. Venta histórica + fecha efectiva permiten determinar qué versión estaba vigente cuando ocurrió la venta.

COGS futuro:

```text
sum(component.quantity × (1 + waste_factor) × cost_per_canonical_unit_at_sale_time)
```

## Checklist

Definición (`checklist_tasks`) y ejecución (`checklist_run_tasks`) son entidades distintas. Al generar una corrida, los campos operativos se copian como snapshot para que una edición futura no cambie el historial.
