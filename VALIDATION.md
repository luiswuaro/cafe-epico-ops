# Validación de V0.1

Fecha de corte: 2026-10-06.

## Validaciones ejecutadas

- El esquema Drizzle y la migración SQL contienen exactamente las mismas 43 tablas de aplicación.
- Los imports relativos y alias internos apuntan a archivos existentes.
- `package.json` es JSON válido.
- Pruebas puras de dominio ejecutadas y aprobadas:
  - 2 cajas × 12,000 ml = 24,000 ml.
  - desviación física 17,000 - teórica 18,400 = -1,400 ml.
  - espresso de 28 s dentro de 22–35 s y 38 s fuera de especificación.
  - recurrencia semanal en viernes.
  - recurrencia cada 3 días.
- Proyecto Supabase real creado: `cafe-epico-ops` en `us-east-1`.
- Migración base V0.1 aplicada correctamente sobre Supabase.
- Seed operativo aplicado: Café Épico, Tepexi, ubicaciones, roles, permisos, Azucena, propietario, checklist, espresso base y SOPs.
- RLS habilitado en las 43 tablas.
- Integridad de `employee_roles` corregida con PK UUID.
- Índices FK revisados: 71 avisos iniciales → 0 FK sin índice.
- Duplicados de índices eliminados.

## Validación automatizada

GitHub Actions ejecuta:

```bash
npm install --no-audit --no-fund
npm run validate:structure
npm run typecheck
npm run lint
npm run build
```

El merge de V0.1 queda condicionado a que ese pipeline pase.

## Pendiente antes de uso operativo

- Crear usuarios en Supabase Auth y vincularlos a los empleados internos:
  - propietario → OWNER
  - Azucena → BARISTA
- Configurar `DATABASE_URL` y variables públicas de Supabase en el proveedor de despliegue.
- Configurar `LOYVERSE_ACCESS_TOKEN` exclusivamente como secreto de servidor.
- Ejecutar primera sincronización Loyverse en modo solo lectura.
- Validar en PC y móvil: login, apertura, espresso QC, recetas, SOPs y entrega de turno.

## Seguridad

- El token de Loyverse y cualquier clave secreta permanecen fuera del repositorio.
- El Data API de Supabase permanece deny-by-default en las tablas sin policy explícita.
- La V0.1 no escribe a Loyverse.
