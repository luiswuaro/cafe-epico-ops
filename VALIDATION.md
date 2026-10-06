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
- Escaneo TypeScript sin resolución de dependencias: sin errores sintácticos inesperados; los únicos errores observados correspondieron a módulos/tipos externos no instalados.

## Validaciones que NO se pudieron ejecutar en este entorno

- `npm install` no completó dentro del límite del entorno, por lo que no existe `node_modules` ni `package-lock.json` generado aquí.
- Por lo anterior, no se pudo ejecutar de forma verificable `npm run build`, `npm run lint` ni el `npm run typecheck` completo con dependencias.
- No hay una instancia PostgreSQL/Supabase disponible en este entorno, por lo que la migración no ha sido aplicada a una base real todavía.
- No hay credenciales reales de Loyverse ni Supabase en este paquete; no se hizo una sincronización contra la cuenta de Café Épico.

## Criterio antes de despliegue

En una estación con Node y acceso de red:

```bash
npm install
npm run typecheck
npm run lint
npm run build
```

Después, en un proyecto Supabase de desarrollo, aplicar `db/migrations/0000_v0_1_core.sql` y `db/seed.sql` y hacer una sincronización Loyverse primero con permisos de solo lectura.
