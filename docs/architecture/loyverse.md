# Integración Loyverse

## Responsabilidad

Loyverse conserva ventas, tickets, artículos e inventario POS. Café Épico Ops no escribe inventario en Loyverse durante V0.1.

## Espejo

Tablas `loyverse_*` preservan payload externo y campos indexables. No se usan directamente como modelo de recetas o inventario físico interno.

## Pull inicial

1. stores
2. items + variants
3. inventory
4. customers
5. receipts + line_items

En el plan actual de Loyverse, la API permite recuperar recibos de los últimos 30 días. Café Épico Ops limita el backfill inicial a esa ventana para evitar respuestas PAYMENT_REQUIRED.

## Webhooks

Endpoint: `POST /api/webhooks/loyverse`.

Para webhooks PAT (sin firma de Loyverse), la URL debe incluir `?token=<LOYVERSE_WEBHOOK_INGEST_TOKEN>`. Para OAuth se valida la firma oficial.

El handler:

1. lee body crudo;
2. valida HMAC-SHA1 cuando existe `LOYVERSE_WEBHOOK_CLIENT_SECRET`;
3. calcula SHA-256;
4. genera una clave idempotente;
5. guarda el evento en `webhook_events`;
6. responde 202 rápidamente.

No se hace trabajo pesado antes del ACK.

## Reconciliación

`POST /api/internal/loyverse/reconcile?mode=initial` hace el backfill inicial de 30 días de receipts. Después, `POST /api/internal/loyverse/reconcile` está protegido por `CRON_SECRET` y procesa el inbox pendiente antes de ejecutar el pull con overlap. Hace pull con una ventana de overlap. Esto cubre pérdida/retraso de webhooks, reintentos y carreras de timestamp.

En producción el scheduler debe ejecutar reconciliación frecuente y una comprobación más amplia nocturna. La cadencia exacta se decide al observar volumen y límites reales del account.

## PAT vs OAuth

V0.1 puede arrancar con Personal Access Token. Los webhooks creados con PAT no están firmados. Para una integración madura/multicuenta se migrará a OAuth; los webhooks OAuth usan `X-Loyverse-Signature`.
