# Café Épico Ops

Sistema web/PWA interno para operar Café Épico. Loyverse sigue siendo el POS y la fuente externa de ventas; Ops agrega ejecución operativa, inventario físico, auditoría, recetas, SOPs, costos y analítica.

## Estado V0.1

Incluido en este corte:

- Next.js 16 + React + TypeScript.
- PostgreSQL/Supabase + Drizzle ORM.
- Supabase Auth y RBAC por permisos.
- Modelo multi-organización, multi-sucursal y multi-ubicación.
- Inventario por ledger inmutable + balance proyectado + conteos físicos.
- Recetas y SOPs versionados.
- Checklist dinámica con frecuencias y snapshots históricos.
- Control de espresso (dosis/yield/tiempo/sensorial; especificación inicial 22–35 s).
- Espejo Loyverse: stores, items, variants, inventory, customers, receipts y receipt lines.
- Inbox idempotente de webhooks y verificación HMAC-SHA1 para webhooks OAuth.
- Reconciliación pull con overlap para recuperar eventos perdidos.
- Seed inicial de Café Épico Tepexi, roles y checklist de apertura de Azucena.
- PWA shell y pantallas iniciales empleado/admin.

Pendiente de credenciales/infraestructura real:

- Crear proyecto Supabase y ejecutar migración/seed.
- Crear usuarios Auth y vincularlos a `employees`.
- Configurar token de Loyverse (solo servidor).
- Publicar URL HTTPS y registrar webhooks Loyverse.
- Elegir scheduler de producción para la reconciliación periódica.

## Arquitectura

```text
Loyverse POS
    │
    ├── REST API ─────────────┐
    └── Webhooks ─────────────┤
                              ▼
                      Café Épico Ops
                      Next.js / Node
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
          PostgreSQL/Supabase        Supabase Auth/Storage
                 │
       ┌─────────┼──────────┐
       ▼         ▼          ▼
 Inventario  Operación   Finanzas/BI
```

El espejo Loyverse está separado del dominio interno. Cambiar de POS no debe obligar a reescribir recetas, inventario físico o SOPs.

## Primer arranque

1. Copiar `.env.example` a `.env.local`.
2. Crear un proyecto PostgreSQL/Supabase.
3. Ejecutar `db/migrations/0000_v0_1_core.sql` en el SQL editor.
4. Ejecutar `db/seed.sql`.
5. Crear usuarios en Supabase Auth y vincularlos con `scripts/link-auth-user.sql.example`.
6. Configurar `LOYVERSE_ACCESS_TOKEN` con permisos de lectura necesarios.
7. `npm install` y `npm run dev`.

> Nunca usar `NEXT_PUBLIC_` para el token de Loyverse ni para la service-role key.

## Comandos

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
npm run db:generate
npm run db:migrate
npm run db:studio
```

## Rutas V0.1

- `/today` — inicio simple del empleado.
- `/checklists` — checklist del turno.
- `/recipes` — recetas vigentes desde PostgreSQL.
- `/sops` — SOPs vigentes y lectura por versión.
- `/quality/espresso` — interfaz inicial de control de espresso; persistencia pendiente.
- `/admin` — panel administrativo protegido por RBAC.
- `/admin/checklists` — alta, programación y activación/desactivación de tareas de checklist.
- `/api/webhooks/loyverse` — recepción de webhooks.
- `/api/internal/loyverse/reconcile` — reconciliación protegida con `CRON_SECRET`.
- `/api/health` — healthcheck.

## Qué funciona en V0.1 y qué queda preparado

**Implementado:** autenticación base, RBAC, checklist diaria materializada desde reglas, captura de resultados, lectura de recetas/SOPs, editor administrativo de tareas, esquema de inventario ledger, espejo/sync de lectura Loyverse, inbox de webhooks y reconciliación protegida.

**Preparado en modelo pero todavía sin flujo completo de UI:** conteos físicos, mermas, escandallo/COGS calculado, edición/publicación de recetas y SOPs, dashboard financiero, compras, producción y capacitación. El formulario visual de control de espresso todavía no persiste registros.

La V0.1 no escribe a Loyverse.

## Principios

1. Una sola fuente interna de verdad para recetas y costos.
2. No sobrescribir historia: movimientos, versiones y ejecuciones se conservan.
3. Empleado: mínima complejidad; dueño: controles completos.
4. El stock físico nunca sustituye silenciosamente al teórico.
5. Escritura hacia Loyverse queda fuera de V0.1.
6. No hay lógica de negocio crítica hardcodeada en una pantalla.

Ver `docs/architecture/` y `docs/adr/`.
