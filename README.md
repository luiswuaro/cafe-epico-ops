# Café Épico OPS

Sistema interno de operación para Café Épico (Tepexi de Rodríguez, Puebla).
La aplicación comercial actual opera sobre **Next.js + PostgreSQL/Supabase**
con POS nativo; Loyverse quedó como integración histórica heredada.

> **Cuidado:** `main` continúa siendo el origen productivo. La rama
> `feat/local-selfhost-qa-bootstrap` prepara una **réplica QA local** y
> todavía no representa una migración comercial terminada.

## Módulos

| Área | Rutas y alcance |
|---|---|
| POS | Catálogo, órdenes, mesas, para llevar, extras y notas |
| Cobro | Pagos, división, caja, descuentos, clientes y puntos |
| Barra | Comandas por rondas, estados, tiempos y recibos |
| Impresión | Estación de impresión y puente ESC/POS en PC |
| Inventario | Artículos, conteos, mermas, recetas y empaque |
| Compras | Planeación, proveedores y sugerencias |
| Calidad | Espresso y procedimientos operativos |
| Tueste | Sesiones, lotes, HiBean, comparativos, maquila |
| Gestión | Checklist, entregas de turno, usuarios y permisos |
| Finanzas | Costos, indicadores, ventas y productividad |

## Estructura del código

```text
app/                         Pantallas, acciones y rutas HTTP
src/domain/                  Políticas puras y reglas unitarias
src/application/             Casos de uso y operaciones de negocio
src/infrastructure/db/       Drizzle y PostgreSQL
src/infrastructure/auth/     Sesiones y RBAC respaldado por DB
db/migrations/               Esquema versionado
scripts/local/               Diagnóstico, réplica y controles QA
infra/local/                 Compose QA y plantilla proxy HTTPS
docs/operations/             Runbooks de lanzamiento y pruebas
docs/adr/                    Decisiones de arquitectura
```

Monolito modular: las reglas compartidas se mantienen separadas de la interfaz.
La arquitectura existente ya contempla `organization_id` y `store_id` en
varios modelos. **Esto no significa** que dos sucursales independientes estén
validadas en producción: ver `docs/adr/ADR-009-local-first-one-authoritative-ledger.md`.

## Modo local de costo cero en suscripciones

El objetivo es que una PC Windows mantenga Next.js, PostgreSQL y Auth locales,
y que dispositivos propios accedan por una red LAN protegida y HTTPS. El
internet remoto se usará solamente para consultas o comandos autorizados, no
como requisito para cobrar por LAN.

**Aún no está desplegado en la PC.** La entrega prepara:

1. `scripts/local/bootstrap-selfhost-qa.ps1`: obtiene una pila self-hosted
   oficial y fijada en versión, pero no la inicia.
2. `scripts/local/start-selfhost-qa.ps1`: verifica credenciales, endpoints
   y puertos antes de iniciar contenedores **QA**.
3. `scripts/local/apply-qa-schema.mjs`: migra y audita esquema local con SHA-256
   y seed sintético de prueba.
4. `scripts/local/start-qa.ps1`: arranca Next.js QA en loopback.
5. `scripts/local/start-qa-gateway.ps1`: valida la IP local e inicia Caddy HTTPS.
   Para Next.js debe configurarse `OPS_LOCAL_CA_FILE` con la CA pública
   `root.crt`; la verificación TLS se conserva habilitada.
6. `scripts/local/qa-smoke.mjs`: auditoría de DB/HTTPS de solo lectura.

**Instalación completa:**
[docs/operations/selfhost-qa-bootstrap.md](docs/operations/selfhost-qa-bootstrap.md)

**Criterios para autorizar el corte:**
[docs/operations/local-qa-acceptance.md](docs/operations/local-qa-acceptance.md)

Las pruebas y certificados son obligatorios; no abrir PostgreSQL,
la estación ESC/POS ni Supabase Studio directamente a la Wi-Fi del hotel.

## Comandos de desarrollo

```bash
npm install
npm run typecheck
npm run lint
npm run validate:structure
npm run build
```

Variables necesarias documentadas en `.env.example`. Nunca añadir archivos
`.env.local`, tokens o claves al repositorio.

## Datos y recuperación

- PostgreSQL es la fuente transaccional de órdenes, movimientos de
  inventario, caja, puntos y auditorías.
- Versionado de recetas/SOPs y movimientos contables históricos.
- `docs/operations/local-backup-runbook.md`: respaldo cifrado continuo a archivo
  (copia manual por ejecución), verificación de integridad y ensayo de recuperación.
- `docs/operations/backup-and-multistore-readiness.md`: política para
  extraer un respaldo cifrado y validarlo, sin afectar producción.
- `docs/operations/lan-local-first-rollout.md`: pruebas LAN/Windows y
  restricciones de red del hotel.
- La conservación de ventas históricas y sesiones Auth requiere restauración
  aislada y verificación. Compilar el proyecto no equivale a trasladar los datos.

## Estado y seguridad

Al migrar se debe verificar POS concurrente, impresora, recuperación, permisos,
pagos divididos, internet desconectado, caja y puntos. Los roles administrativos
no deben depender de botones ocultos: la aplicación comprueba permisos en el
servidor/DB. La estación impresora necesita flujo durable y acuses
idempotentes para reintentos.

No desplegar la rama QA como POS LIVE ni reemplazar Supabase/Vercel comercial
antes de completar la hoja de aceptación.
