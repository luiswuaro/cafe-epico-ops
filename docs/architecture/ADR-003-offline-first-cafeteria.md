# ADR-003 · Operación offline-first con nodo local de Café Épico

**Estado:** Propuesta de arquitectura — NO implementada en producción.  
**Fecha:** 2026-10-12  
**Sistema actual:** Next.js (Vercel), PostgreSQL/Supabase, POS propio OPS, impresión RAW ESC/POS mediante puente Windows en `127.0.0.1:9137`.

## 1. Objetivo

Mantener ventas, órdenes, rondas de mesa, preparación en barra, impresión, movimientos de caja y consumo de inventario aunque falle internet, siempre que el nodo local (PC) y la LAN sigan disponibles; sincronizar después sin duplicar efectos económicos ni documentos.

Inspiración documentada: Toast Offline Mode with local sync; Loyverse POS Offline; Shopify POS offline checkout; Square offline payments (con limitaciones específicas de proveedor, no reproducibles con nuestro bridge).

## 2. Hallazgos de código (2026-10-12)

- `public/sw.js` guarda principalmente recursos estáticos; deliberadamente no cachea navegación HTML autenticada ni API. **No permite cobrar offline**.
- `/pos` usa renderización de servidor con consultas a Supabase; los cobros usan Server Actions y `checkoutLiveOrder` con transacción PostgreSQL.
- `checkoutLiveOrder` ya emplea `clientOrderId`, locks por sucursal, validaciones y movimientos de inventario. No sirve importar un pedido offline ejecutándolo con los precios/recetas **actuales**: se requiere snapshot de la venta original.
- El puente Windows escucha solo loopback; teléfonos necesitan un servicio de aplicación en LAN que reenvíe impresión de forma autorizada hacia ese puente.
- El hub de impresión en navegador no es un servicio Windows permanente. El hotfix de octubre controla trabajos retrasados, no crea operación offline.

## 3. Arquitectura decidida para desarrollar (no desplegar hasta pruebas)

```text
                      Con INTERNET                     SIN INTERNET
Android / PC POS  ────────┬──────────────────────────────────────────────
                          │  LAN / Wi-Fi estable
                          ▼
                Nodo local Windows (autoridad POS)
           API HTTPS local + UI POS + SQLite WAL
          ┌───────────────┼───────────────────┐
          ▼               ▼                   ▼
      Caja/órdenes   Outbox persistente  Spool impresión
          │               │                   │
          │               │                   ▼
          │               │            Bridge ESC/POS 127.0.0.1
          │               │
          │               └──── cuando haya internet ───▶
          │                        API de ingesta
          └────────────────────────────────────────▶ Supabase/PostgreSQL
                                            └──── Vercel/reportes/ERP
```

### Regla de escritura única

Durante operación en tienda, **todos** los POS escriben en el nodo local, incluso cuando sí hay internet. Evitar dos escritores concurrentes (nube y SQLite) para la misma caja. El nodo es autoridad POS local y la nube se actualiza por replicación. Procesos administrativos remotos no deben mutar tickets locales abiertos.

### Tecnología propuesta

- Servicio residente Windows, con arranque al iniciar el sistema, watchdog y logs rotativos. No depender de mantener una pestaña de Chrome abierta.
- SQLite en modo WAL, transacciones `BEGIN IMMEDIATE`, constraints, checkpoint, copia de seguridad consistente y verificación `PRAGMA integrity_check`.
- API local autenticada (TLS y certificados/instalación confiables en dispositivos; o aplicación móvil empaquetada con autenticación de canal). **No abrir el bridge loopback a toda la red**.
- API local de eventos: `/local/pos/orders`, `/local/pos/payments`, `/local/print`, `/local/health`, `/local/sync`.
- Catálogo y recetas descargados con versión y precios snapshot; cache de empleados con permisos y PIN verificado localmente. No almacenar tokens o secretos en HTML ni exponer saldos sensibles a roles de barra.
- Router LAN estable; IP reservada para PC; UPS del router/PC según dimensionamiento, sin garantía de autonomía aún.

## 4. Modelo de eventos y transacciones

Cada operación lleva `event_id UUID`, `device_id`, `store_id`, `local_order_id UUID`, `business_date`, `occurred_at`, `schema_version`, `catalog_version`, `recipe_version`, `local_sequence` y `idempotency_key` única.

Transacción **local y atómica**: guardar venta / cobro y sus snapshots + movimientos locales de caja/inventario + trabajo de impresión + evento OUTBOX. Confirmar al operador solo tras persistencia local. Eventos `PENDING → SENDING → ACKED`; el servidor debe responder el ID persistido y aceptar repeticiones sin aplicar dos veces. Todo reintento usa la MISMA clave de idempotencia. Conflictos van a `NEEDS_REVIEW`, sin inventar una venta nueva.

La importación en nube se realiza en transacción con índice único en `(organization_id,event_id)` y unicidad de `local_order_id`. No recalcular importes con menú actual ni repetir descuento de inventario/caja/beneficios después de un ACK perdido. Conservar precio, receta y servicio exactos al vender.

### Identidad de documentos

- Folio offline `OFF-<device/store>-<business date>-<secuencia>` presentado provisionalmente, vinculado al folio definitivo al sincronizar sin alterar la identidad del pedido.
- Diferenciar `SALE_CREATED`, `PAYMENT_RECORDED`, `INVENTORY_CONSUMED`, `KITCHEN_PRINT_REQUESTED`, `PRINT_BRIDGE_ACKED`, `CASH_SESSION_CLOSED`.
- ACK ESC/POS significa envío aceptado por el spool de Windows, **no prueba física del papel**. Si el estado es incierto, pedir conciliación manual antes de reimprimir.
- Una comanda impresa localmente se marca como impresa y **no se envía de nuevo a la cola cloud** durante sincronización.
- Un pedido de varias rondas usa `order_uuid + round_uuid`, no solo el nombre de mesa.

## 5. Reglas de pagos offline

| Medio | Política sin internet |
|---|---|
| Efectivo | Permitir con caja local abierta; calcular cambio; registrar `CASH` en ledger. |
| Tarjeta | Solo si la terminal **independiente** autoriza realmente y emite comprobante; registrar referencia/estado. OPS no captura ni almacena números de tarjeta. Si terminal no procesa: no mostrar como cobrado. |
| Transferencia | Solo `TRANSFER` pagado tras verificar acreditación por canal bancario disponible; sin verificación usar `AWAITING_TRANSFER_VERIFICATION`, excluida de efectivo y de ventas efectivamente cobradas. |
| Puntos | Acumular provisionalmente 5% de dinero realmente cobrado y sincronizar; el canje requiere ledger actualizado y autorización. Primera fase: canjes desactivados offline. |
| Cortesía empleado | Validar cupo diario en nodo local y aplicar una sola vez; conservar empleado y beneficio por línea. |

No ofrecer pagos con tarjeta offline de adquirente como hacen Square/Toast sin hardware y acuerdos que lo soporten.

## 6. Inventario, costos, seguridad

- Consumir recetas locales y empaque por servicio (12 oz caliente, 16 oz frío, en salón sin desechable salvo popote frío); agua/hielo solo costo, sin existencia.
- Incluir merma de café, leche y jarabes en receta versionada y coste local. El movimiento local se refleja una sola vez en nube.
- Advertencia de stock offline con sello de último sincronizado; en caída no afirmar saldo remoto actualizado.
- Empleados: ventas y comandas sí, historial de tickets y sesiones anteriores bajo clave de dueño, **también offline**. PIN con hash, caducidad y bloqueo por intentos.
- No entregar acceso a administración de nube ni alteración de precios a un cliente offline desconectado.

## 7. Estados visibles

`ONLINE_SYNCED`, `ONLINE_PENDING`, `LAN_OFFLINE_SYNC_PENDING`, `LOCAL_PRINTER_DOWN`, `LOCAL_HUB_DOWN`, `SYNC_CONFLICT`.

Banda POS muestra **última comunicación**, **cantidad y monto de ventas pendientes**, **estado de impresión**, **estado local/cloud**. Nunca mostrar `Pagado en nube` cuando solo está persistido localmente.

## 8. Continuidad por falla

| Falla | Ruta de operación |
|---|---|
| ISP internet cae, LAN y PC siguen | POS móvil y PC al servidor local; imprimir, guardar caja, ventas e inventario local; sincronizar al volver. |
| Vercel/Supabase caen, LAN activa | Igual que caída de ISP, con alerta de nube. |
| Wi-Fi cae, PC sigue y printer USB | Solo PC usando localhost; atención móvil requiere restablecer red o registro manual. |
| PC apaga, móvil sigue | Fase de respaldo posterior: un solo dispositivo autorizado con outbox local, sin impresión POS-58 hasta recuperar PC. No habilitar múltiples maestros desconectados. |
| Se corta luz | Necesario dimensionar UPS y procedimiento manual de emergencia. |
| Tarjeta/transferencia sin verificación | No marcar cobrada; aceptar efectivo u otro medio autorizado. |

## 9. Fases y liberación

### Fase 0 · Contrato y QA

Definir esquema de eventos, snapshot inmutable y contrato de ingesta idempotente. Añadir simulador de caída de WAN y reenvío duplicado sin tocar ventas reales.

### Fase 1 · Caja PC offline

Node/Windows local + SQLite + catálogo/recetas + venta directa + efectivo + impresión; sincronización al volver. Despliegue inicial pilotado en PC sin modificar producción hasta pasar test físico.

### Fase 2 · LAN multipunto

Tableta Samsung y celulares conectan al mismo hub; comandas y mesas/rondas sincronizadas por LAN. Acceso seguro con rol/PIN y estado visible de conexiones.

### Fase 3 · Reconciliación y contingencias

Clientes/puntos provisionales, terminal externa verificada, corte offline reconciliado, conflictos auditados, exportación cifrada del outbox y opción de único móvil de emergencia.

## 10. Criterios obligatorios de aceptación

1. Desconectar **solo la WAN** (mantener LAN), guardar, imprimir y cobrar 10 operaciones (efectivo, para aquí, para llevar, rondas y descuentos), sin errores ni tickets retrasados.
2. En una venta, interrumpir comunicación entre el "guardar local" y el ACK al cliente; reintentar misma clave: una venta, un inventario, un cobro, una comanda.
3. Reactivar WAN, reproducir OUTBOX dos veces: resultados centrales idénticos en ventas, COGS, inventario, caja y puntos.
4. Cambiar receta/precio en nube mientras hubo venta offline: venta histórica conserva snapshots originales.
5. Prueba simultánea PC + Android con LAN: misma mesa, dos rondas; orden consistente y un comprobante por ronda.
6. Desconectar impresora USB a mitad de trabajo: no afirmar papel físico ni reimprimir automáticamente sin reconciliar.
7. Caída de Windows tras commit local: al reiniciar, recuperar operación y cola sin perder venta confirmada.
8. Desconectar LAN (no solo WAN): mostrar ruta degradada, no afirmar impresión móvil.
9. Usuario empleado intenta acceder a historial/caja offline sin clave: acceso denegado.
10. Hacer corte provisional con tickets sin sincronizar: monto pendiente separado y conciliación posterior.

## 11. No desplegar prematuramente

No habilitar cobros offline con una PWA que solo cachea pantallas, ni permitir múltiples dispositivos escribiendo SQLite independientes. Requiere transacciones atómicas, pruebas reales y plan de reversión. El sistema cloud actual sigue operando hasta reemplazar el flujo de caja local de manera verificada.

## Referencias oficiales

- Toast: https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html
- Loyverse: https://help.loyverse.com/es/help/offline-work-of-pos
- Shopify: https://help.shopify.com/es/manual/sell-in-person/shopify-pos/selling-offline
- Square: https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode
