# QA: Café Épico OPS — rama de Preview 2026-10-09

## Condiciones previas

- Preview debe usar **base de datos de pruebas**, URL Supabase de pruebas y variables de entorno independientes. No efectuar pagos LIVE ni cancelaciones de prueba si apunta a producción.
- No fusionar el PR ni desplegar en producción antes de aprobar estas pruebas.
- Preparar caja de pruebas abierta, stock de café, vaso, tapa y otros consumibles mapeados, cuenta de empleado y propietario.
- Capturar hora, folio, orden, cuenta, método, estado final y movimientos de inventario de cada prueba.

## Pruebas de caja e inventario

1. **Dos americanos, 2 cuentas, mismo insumo**: guardar ticket LIVE, asignar 1 americano a cada cuenta, cobrar cuenta 1 y comprobar recibo individual. Cobrar cuenta 2 y comprobar recibo individual y orden PAID. Confirmar dos pagos y descuento de café por cada uno, sin duplicados.
2. **Cobro fallido cuenta 2**: hacer que stock de café sea insuficiente *en base de pruebas*. Confirmar que se muestra error legible y cuenta 2 queda OPEN. Propietario puede permitir diferencia auditada si ya se entregó el producto; empleada no.
3. **Doble toque o doble dispositivo**: intentar pagar la misma cuenta dos veces. Debe existir un solo pago, un solo descuento de inventario y un solo movimiento de puntos.
4. **Cancelar 2 cuentas pagadas en efectivo**: con caja de pruebas abierta, cancelar desde ticket completo y registrar motivo. Confirmar status CANCELLED, devoluciones de efectivo, puntos revertidos y una reversa consolidada de inventario por insumo/ubicación. Repetir solicitud y comprobar ausencia de reversas duplicadas.
5. **Cancelar con tarjeta o transferencia**: verificar mensaje de necesidad de devolución externa sin pantalla de error, sin ejecutar reembolso automático ni mutar caja.
6. **Ticket completo después de dividir**: mostrar método(s) registrados, y si hay una cuenta pendiente mostrar monto abonado y acceso a cuentas por cobrar.

## Empaque adicional postventa

7. Cobrar bebida en modalidad Aquí. Registrar 1 envase desde ticket completo. Verificar descuento **sólo** de la diferencia de empaques de receta Para llevar menos Aquí; sin descuento nuevo de café, leche o azúcar; sin nuevo pago ni puntos.
8. Verificar que la modalidad original permanece Aquí y queda evidencia en auditoría. Repetir la misma solicitud con el mismo requestId: no deben duplicarse movimientos.
9. Si no hay existencias o falta mapeo de vaso/tapa, informar el insumo sin registrar consumo parcial. Probar que en frío no se descuenta otro popote si la receta Aquí ya lo incluía.

## UX

10. En celular, abrir Menú lateral, navegar a POS, Comandas, Caja, Inventario y volver. Tocar fondo oscuro y Escape para cerrarlo. Revisar 320/375/430 px, orientación horizontal, tablet y escritorio.
11. Acceso de Azucena: las rutas administrativas no deben aparecer; el propietario debe ver Gestión. Comprobar áreas táctiles de 44 px como mínimo.
12. Revisar impresión ESC/POS y navegador en tickets individuales y completos. No modificar totales ni incluir empaques extra como un segundo producto vendido.

**Criterio de salida:** CI (typecheck/lint/build) satisfactorio + pruebas manuales en Preview con BD aislada + confirmación de operación real por responsable antes de fusionar.

## Pruebas obligatorias — precios y bloqueo histórico (agregadas)

13. **Cambiar precio importado**: desde Gestión → Catálogo POS editar un americano de prueba de $30 a $35; confirmar que OPS muestra $35 y el producto externo de Loyverse conserva $30. Auditar usuario, precio anterior y nuevo.
14. **Cambiar precio manual**: editar alimento creado en OPS; validar actualización, permiso de propietario y evento de auditoría.
15. **Precio congelado en ticket guardado**: guardar ticket con dos americanos a $30, dividir en dos cuentas y cambiar el precio de catálogo a $35. Cobrar ambas cuentas: **$30 cada una**, total original **$60**, inventario de dos shots según receta original y puntos sobre importes realmente pagados. Nueva venta deberá mostrar $35.
16. **Nueva ronda tras cambio**: mantener una mesa abierta con americano de $30, cambiar catálogo a $35 y añadir otro americano en nueva ronda. Cobrar sin fusionar los precios: líneas de $30 y $35, total $65. Dividir en cuentas y repetir validación para cada línea histórica.
17. **Receta alterada después de guardar**: guardar ticket, modificar la receta del catálogo y cobrar el ticket antiguo. Se aplican los componentes registrados en la línea original, no la nueva receta. Nueva venta usa receta vigente.
18. **Concurrencia**: cambiar precio desde dos sesiones administradoras; comparar evento anterior/posterior y revisar que sólo la actualización final determine el catálogo, sin alterar tickets guardados.
19. **Permisos**: usuario sin `pos.catalog.manage` no puede editar precio ni invocar la operación por POST.
20. **Errores sin pantalla negra**: cambiar o eliminar la división en un ticket cerrado, simular pago repetido y stock insuficiente. Esperar mensajes legibles, orden y cuentas intactas y sin doble consumo.
21. **Cancelación parcial**: cobrar solo cuenta 1 de mesa dividida y cancelar ticket completo en caja de pruebas. Verificar que el ingreso cobrado se reversa, que cuenta 2 no registra pago ni inventario, y que la pantalla de división indica que la mesa está cerrada.
22. **Precio e historial**: imprimir recibos individual y completo de las cuentas previamente separadas después de cambiar precio; total original congelado, cobros y clientes correctos.

## Regla de QA
La ejecución de GitHub Actions prueba estructura, tipos, lint y compilación, **no** los efectos de las transacciones SQL ni el comportamiento en teléfonos físicos. Estas pruebas deben completarse en un ambiente Preview aislado, no en la base de datos de producción.


## QA-01 — COBROS DIVIDIDOS: aprobado mediante transacciones reales QA (2026-10-09)

- Orden QA: `SH-261009173749-DC3A` (UUID `d2256e98-126a-43ac-924e-5baafc0fe278`), única orden QA de la prueba, `mode=LIVE`, `status=PAID`, `inventory_effect_applied=true`.
- Dos líneas de `Americano QA caliente`, 1 pieza a $30 cada una, `serviceMode=DINE_IN`, insumo de receta congelada: 18.900 g café por unidad.
- `Cuenta 1` pagada $30 `CASH`, importe entregado $30, cambio $0; `Cuenta 2` pagada $30 `TRANSFER` simulada.
- Totales conciliados: 2 splits = $60, 2 pagos = $60, total del folio = $60.
- Dos movimientos distintos de café `SALE -18.900 g` (uno por split, IDs diferentes), total -37.800 g.
- Inventario QA `QA_CAFE_G` pasó de 6000.000 g a 5962.200 g. Insumos de vaso/tapa/servilleta sin consumo para `DINE_IN`.
- Caja QA sigue `OPEN`: fondo inicial $500 + único `pos_cash_movements SALE $30` de Cuenta 1 = **$530 en efectivo esperado**; la transferencia no afectó caja en efectivo.
- Sin cliente: 0 `pos_loyalty_entries`, sin puntos acreditados, comportamiento esperado.
- Integridad de referencias: 0 pagos cruzando organizaciones; 0 movimientos de inventario `POS_LIVE_ORDER` cruzando organizaciones. Entre 23:35 UTC y la consulta, QA generó 1 orden/2 pagos/2 movimientos; producción 0 órdenes/0 pagos/0 movimientos.
- Auditado en `audit_events`: `POS_LIVE_COMMAND_SENT`, `POS_ORDER_SPLIT_SAVED`, dos `POS_LIVE_SPLIT_PAID`; el último marca `finalPayment=true`.
- **Pendiente:** verificación física de las dos impresiones individuales en navegador/ESC-POS. El estado de base no prueba el resultado impreso.
- **Siguiente QA:** para probar cancelación y reversas de inventario, crear otro pedido con **ambas cuentas en efectivo**. El ticket mixto de esta prueba debe rechazar la cancelación automática mientras no se confirme administrativamente el reembolso externo.


## QA-02 — CANCELACIÓN DE DOS CUENTAS EN EFECTIVO: aprobado (2026-10-09)

- Orden de prueba `SH-261009174215-B713` (id `97864bff-fa9f-4290-8854-a991b0afa1e7`), 2 americanos QA calientes en `DINE_IN` a $30 por cuenta.
- Se registraron 2 `pos_order_splits` en `PAID`, 2 pagos `CASH` de $30, y dos movimientos `SALE` de caja +$30.
- Inventario: dos movimientos de café por `-18.900 g`; al cancelar se insertó un **único** movimiento `POS_LIVE_CANCEL` de `+37.800 g`, con proveedor `OPS_POS_CANCEL`, sin conflicto por clave repetida.
- Se registraron dos movimientos `REFUND` de `-$30` en caja. Caja abierta QA: fondo $500 +$30 de QA-01 +$60 de QA-02 -$60 de reversa = **$530 esperado**.
- Café QA: 6,000 -37.8 de QA-01 -37.8 de QA-02 +37.8 de reversa = **5,962.2 g**.
- Orden principal `CANCELLED`, `inventory_effect_applied=false`, motivo `prueba`. Auditoría `POS_LIVE_CANCELLED_REVERSED` confirma 2 movimientos de consumo, 2 devoluciones de caja y 0 movimientos de puntos.
- La organización de producción `cafe-epico` conservó sus 19 órdenes, la QA tiene 2 (1 PAID, 1 CANCELLED).
- **Regla operativa:** esta reversa es teórica. Si el café ya fue preparado, registrar merma física independientemente (no retornar café real a una tolva ficticia).

### UI: error encontrado y corrección propuesta
- La vista del ticket aplicaba `max-width:58mm` a `.receipt-shell` en pantalla, por eso el panel de desechables tenía una columna de 58 mm y el nombre del americano se partía por letra.
- Corrección en Preview: ancho de lectura para pantalla; solo `.receipt-paper` conserva 48 mm, con `@media print` intacta. Nuevo acceso «Vaso para llevar», filas legibles y etiqueta de pago original cuando se cancela.
- **Pendiente:** prueba visual sobre Preview corregido y prueba funcional de `POS_EXTRA_TAKEAWAY_PACKAGING` en una venta QA nueva, incluyendo evitar doble descuento del café.


## QA-03 — ENVASE POSTVENTA «AQUÍ» → PARA LLEVAR: aprobado (2026-10-09)

- Orden QA: `OP-20261009235256-003CB`, `d53783ad-66af-4f50-a4d3-f14fc5d519ca`, `LIVE / PAID`, $30, Americano QA caliente `DINE_IN` (snapshot original preservado).
- 1 solo pago de $30, `customer_id=null`, 0 movimientos de puntos.
- Venta: 1 movimiento `POS_LIVE_ORDER` de **−18.900 g café** a las 23:52:56 UTC.
- Entrega de empaque ~8 s después: 1 evento `POS_EXTRA_TAKEAWAY_PACKAGING` (`request_id=437a1606-30fc-4fb0-b86e-41badeb5334f`) y 3 movimientos con proveedor `OPS_POS_PACK`: vaso caliente −1, tapa caliente −1, servilleta −1.
- Saldos verificados: café QA 5962.2→5943.3 g; vasos 200→199; tapas 200→199; servilletas 300→299; popote 200 sin cambios. El empaquetado no descuenta café por segunda vez.
- Caja QA `OPEN`: $530 antes + $30 de esta venta = **$560 esperado**. No se detectó un segundo pago.
- Integridad: `packaging_events=1`, `packaging_movements=3`, 3 insumos distintos bajo un mismo requestId. En la ventana de esta operación, QA registró 1 orden, 1 pago y 4 movimientos (café+3 empaques); producción 0 órdenes, 0 pagos y 0 movimientos.
- **Pendiente de prueba:** idempotencia ante doble toque simultáneo, producto frío con popote ya consumido, falta de stock de vaso/tapa, y cancelación posterior a entregar empaque (criterio de merma vs reversa).
- Auditoría basada en lecturas SQL; no hay cambios de datos ni despliegue de producción por este registro.


## QA-04 — FRÍA YA CON POPOTE, CAMBIO A VASO PARA LLEVAR: aprobado (2026-10-09)

- Folio `OP-20261009235607-6A9A1`, orden `4c6819ec-a1db-4dd1-9673-9d27996751aa`, 1 Latte español QA frío, $70, `LIVE/PAID`, servicio de venta congelado `DINE_IN`.
- Venta: consumo de café `-18.900 g`, leche `-230 ml`, leche condensada `-45 g`, hielo `-150 g` y **popote `-1 pz`**.
- Tres segundos después, un único evento `POS_EXTRA_TAKEAWAY_PACKAGING` (requestId `6406249c-c179-415a-b414-dad70504f83c`) generó **exactamente tres** movimientos `OPS_POS_PACK`: vaso frío 16 oz `-1 pz`, tapa fría `-1 pz` y servilleta `-1 pz`.
- **No se descontó un segundo popote** ni café/leche/condensada/hielo durante la entrega de envase adicional. Existe 1 evento de empaque con 3 insumos distintos; no hay movimientos repetidos de ese evento.
- Existencias QA verificadas: café `5924.400 g`, leche `14770 ml`, condensada `4955 g`, hielo `11850 g`, popote `199 pz`, vaso frío `199 pz`, tapa fría `199 pz`, servilleta `298 pz`.
- **Finanzas:** una única operación `CASH $70`, `payment_count=1`, `payment_total=$70`, puntos `0` (no había cliente). Caja QA continúa `OPEN` con **$630 esperado** (`$500 + $130 neto`).
- **Aislamiento:** desde 23:55 UTC, en `cafe-epico-qa` se registraron 1 orden, 1 pago, 8 movimientos (5 de receta + 3 de empaques); `cafe-epico` 0 órdenes, 0 pagos y 0 movimientos.
- Comprobación visual aportada por operador: panel «Entregar vaso para llevar» se muestra legible y marca `Registrado`; la validación del procesamiento corresponde a las consultas SQL previas.
- **Pruebas pendientes:** doble clic simultáneo con distintos requestIds, falta de stock, edición de precio con ticket abierto, cancelación después de empaque, impresión térmica real. Se mantienen fuera de producción.
