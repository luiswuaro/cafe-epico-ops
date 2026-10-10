# Paquete operativo POS: beneficios y canjes — SOLO PREVIEW

**Estado**: checkout POS conectado y preparado para preview; la lógica LIVE solo se ejecuta con `POS_LIVE_ENABLED=true`. No fusionar a producción antes de validación con datos aislados.
**Reglas confirmadas**: 1 punto acumulado vale $1.00 MXN cuando se canjea (10/oct/2026). Tasa no editable por cajeros. El cliente acumula 5% exclusivamente sobre efectivo, tarjeta o transferencia efectivamente cobrados; los puntos redimidos no acreditan puntos nuevos.
**Integración**: preparado a partir del PR #73. El presupuesto compartido del PR #72
se integrará tras resolver diferencias en `financial-workbench.tsx` y `globals.css`.

## Diseño operativo reemplazado: canje dentro de COBRAR

La ruta de simulador independiente fue retirada. El cliente y el canje ahora se gestionan
en la pantalla de cobro habitual, sin reconstruir el ticket:
- **Venta nueva (POS espejo):** al pulsar **Simular cobro** se selecciona cliente,
  se canjean puntos, se elige efectivo/tarjeta/transferencia y se muestra la cantidad
  monetaria restante; en espejo NO se escribe en base de datos.
- **Venta nueva (POS LIVE):** al pulsar **Cobrar**, la misma pantalla envía
  identificador de cliente y puntos; la transacción valida saldo, descuenta puntos
  con bloqueo de fila, registra `REDEEM` (negativo), crea pago `POINTS` sin caja,
  y registra el dinero cobrado por su medio real.
- **Ticket guardado:** selección de cliente, canje y registro rápido en
  `/pos/checkout?ticket=<id>`. El ticket original permanece ligado a la venta.
- **Alta rápida:** integrada en el cobro. En modo espejo es solo local; en LIVE
  usa la acción autenticada y deja registro de auditoría.
- **Cobro con 100% puntos:** `POINTS` como liquidación completa y cero ingreso de caja;
  el sistema sigue descontando receta e inventario de venta.
- **Cancelación:** reversa `EARN` y `REDEEM`, con guardia de saldo no negativo.
- **Comprobante:** muestra importe cubierto por puntos y pago monetario por separado.

### Aún pendiente
- Permitir descuentos especiales y cortesías de personal dentro del cobro en lugar
  del cálculo de laboratorio.
- Canjes por cuenta dividida (el flujo dividido actual continúa sin selector de canje).
- Ejecutar pruebas E2E contra una base de datos **aislada**, con dos cajas concurrentes.
- Confirmar tratamiento fiscal con contabilidad y conciliación con saldos Loyverse.

## Alta rápida de cliente en ambas pantallas

- **POS / carrito:** selector con búsqueda y “Registrar cliente nuevo aquí” antes de
  guardar o cobrar. Conserva todas las líneas, notas, presentación y extras.
- **Cobrar:** el mismo formulario de cliente y puntos sigue disponible.
- **Espejo / preview:** alta simulada en memoria; no se escribe a `pos_customers`,
  ni se asigna un identificador simulado a una orden escrita.
- **LIVE:** alta transaccional autenticada en la organización, con auditoría,
  sin navegación ni pérdida del carrito.
- Al registrar desde POS se conserva el cliente elegido al entrar a cobrar.

## Beneficios de personal por producto y por empleado (preview)

Cambio de arquitectura: el menú de **Azucena en toda la cuenta** fue sustituido
por la asignación **por línea de carrito**. El POS obtiene trabajadores activos
de la misma organización/sucursal; ya no existe una empleada hardcodeada.

Flujo de caja con dos o más personas:
1. Agregar bebidas al mismo ticket (cliente + trabajadores).
2. En **Cobrar / Simular cobro**, cada línea se asigna como:
   * **Cliente / venta normal**, o
   * **Personal · bebida incluida**, o
   * **Personal · bebida adicional −10%**.
3. En las líneas de personal, seleccionar a **qué trabajador** corresponde.
   Se pueden elegir varios trabajadores distintos en un solo ticket.
4. Elegir cliente registrado y canjear puntos únicamente contra **las líneas
   de cliente**. Se suman por separado el cliente y el personal.
5. En el resumen se muestran: total de lista, descuentos personal, base
   de cliente, parte de personal, puntos canjeados y monto monetario total.
   **Sólo el importe monetario de productos del cliente genera el 5%.**

Ejemplo de prueba (valores ilustrativos):
- Latte cliente $70, bebida incluida del empleado A $60 y bebida adicional
  de empleado B $80 con $10 de extra: lista $220.
- Descuento empleados: $60 + $8 = $68.
- Saldo personal: $82; cliente: $70.
- Si canjea 20 puntos del cliente: cobro monetario $132 y 2.50 puntos nuevos
  para el cliente (su pago real fue $50).

Reglas prototipo:
- El descuento de personal se calcula sobre el precio base, no sobre extras.
- Una cortesía por trabajador **dentro del mismo ticket**; aún falta bloquear
  una segunda cortesía en otro ticket de la misma jornada.
- No acumular descuento de termo y de personal sobre la misma bebida;
  sí puede usar termo el cliente mientras otra línea sea de personal.
- Los alimentos quedan fuera de este selector hasta definir la política.
- El beneficiario no es necesariamente el cajero, por eso se elige empleado.
- **Política por verificar:** se está simulando el mismo esquema de bebida
  incluida + 10% para todos los empleados activos. Falta autorización del
  propietario para establecer reglas individuales.

### Bloqueo antes de operar en LIVE

Los descuentos y cortesías de personal siguen **deshabilitados para cobro
LIVE**. El botón de confirmar se desactiva cuando hay una línea de personal.
La prueba actual es UI y cálculo puro sin mutaciones. Pendiente:
- Reglas configurables por empleado (beneficiario, vigencia, turno/jornada).
- Movimiento de inventario y COGS de cada producto regalado.
- Registro transaccional por línea, trabajador y jornada (idempotencia,
  bloqueo de concurrencia y reversas).
- Cuentas divididas / comandas guardadas con beneficios por línea.
- Conciliación con efectivo/tarjeta/transferencia, impuestos y puntos.
- E2E multiusuario contra PostgreSQL aislada antes de habilitar el uso LIVE.

## Casos de negocio

| Caso | Frontend | Backend LIVE requerido |
| --- | --- | --- |
| Bebida con termo | -5 MXN por unidad y elimina empaques de receta | Validar bebida+takeaway; receta correcta y snapshot por línea |
| Cortesía personal | Seleccionar una bebida y beneficiario (empleado) | Una bebida de precio base por turno; reservar beneficio dentro de transacción; cobrar extras; inventario real |
| 10% personal | Elegir bebida adicional | Identificar beneficiario; calcular 10% del precio base con permisos/condiciones aprobadas |
| Puntos por bebida | Canjear saldo por una línea, 1 punto = 1 MXN | Usar puntos reales solo una vez y reflejar el canje en esa línea |
| Puntos por cuenta | Canjear hasta cubrir saldo, 1 punto = 1 MXN | Pago mixto efectivo/tarjeta/transferencia + puntos; sin saldos negativos |
| Descuento manual | Importe fijo o % sobre línea/cuenta | Motivo obligatorio; autorizar rol propietario; auditar autorizador distinto del cajero |
| Cuenta dividida | Canje/beneficio exclusivo de la fracción pagada | No descontar dos veces ni aplicar más que saldo de la fracción |
| Cancelación | Vista reversión | Revertir EARN y REDEEM; controlar devoluciones externas y saldo reutilizado |

## Pendientes de aprobación del propietario

- [x] Valor de canje autorizado por propietario: **1 punto = $1 MXN**, conversión fija en dominio y pantalla (10/10/2026).
- [x] **5% solo sobre importe monetario realmente cobrado**: efectivo, tarjeta o transferencia, después de descuentos y puntos redimidos (confirmado el 10/10/2026). Compra pagada 100% con puntos genera 0 puntos nuevos.
- [ ] Si los puntos y el descuento por termo pueden combinarse.
- [ ] Definir si cortesía de personal cubre extras y si puede aplicarse a termo.
- [ ] Quién autoriza descuentos excepcionales y límites de importe/porcentaje.
- [ ] Política de saldo importado de Loyverse al activar canjes en OPS.

## Requisitos de diseño antes del cobro LIVE

1. Identificación del beneficiario (no inferir que el cajero es quien toma la bebida).
2. Cortesía: movimiento de inventario y gasto de personal, incluso en ticket de $0.
3. Canje: ledger de puntos `REDEEM` y cargo de dinero separados; no contabilizar puntos como efectivo.
4. Cobros: total de pagos monetarios + canje = total pendiente sin duplicados.
5. Puntos: `SELECT ... FOR UPDATE` del cliente, bloqueo de saldo y atomicidad de transacción.
6. Idempotencia: `clientOrderId`, canje y consumo de cortesía exactamente una vez.
7. Auditoría: tipo, motivo, importe, operador, autorizador, beneficiario, cliente y orden.
8. Descuentos: base de cálculo explícita; nunca alterar el precio de lista de catálogo.
9. Inventario: receta de presentación correcta y merma según configuración; beneficios no omiten ingredientes.
10. Visibilidad: renglones en precuenta, comanda (solo observaciones operativas), recibo y reporte financiero.
11. Reversas: cancelar devuelve puntos canjeados y revierte puntos ganados sin generar saldo ficticio.
12. Cobros LIVE prohibidos para beneficios hasta pasar tests aislados de PostgreSQL, permisos y concurrencia.

## Matriz mínima de aceptación

- [ ] Latte caliente para llevar con termo: descuento 5, ingredientes sí, vaso 12 oz no.
- [ ] Taro frío para llevar con termo: descuento 5, ingredientes sí, vaso 16 oz y popote no.
- [ ] Validación rechaza temperatura de empaque equivocada en receta.
- [ ] Cortesía personal primera vez: 0 MXN en bebida base, inventario descontado, registro nominal.
- [ ] Segunda cortesía mismo turno: bloqueada incluso con dos dispositivos.
- [ ] 10% adicional: aplica solo a bebida autorizada; otros productos sin descuento.
- [ ] Puntos por una bebida: solo aplica a esa línea; saldo de puntos disminuye.
- [ ] Puntos por cuenta: saldo suficiente, insuficiente y canje exacto.
- [ ] Full puntos: 0 MXN monetario y sin movimiento falso de caja.
- [ ] Compra $150, redimir 50 puntos y cobrar $100 por cualquier medio monetario: 5 puntos nuevos.
- [ ] Pago mixto $25 efectivo + $45 tarjeta + $30 transferencia: 5 puntos nuevos.
- [ ] Una compra que use $150 en puntos y $0 reales genera 0 puntos nuevos.
- [ ] Aplicar descuentos antes de determinar la base de acumulación, nunca el precio de lista.
- [ ] Canje parcial + efectivo: caja solo por efectivo y cambio correcto.
- [ ] Canje parcial + tarjeta: terminal solo por importe monetario.
- [ ] Ticket guardado / ronda adicional: conserva beneficio congelado al cobrar.
- [ ] Cuenta dividida: canje una sola vez por sección.
- [ ] Cancelación antes/después de pagar y pérdida de conexión: reversa idempotente.
- [ ] Orden simultánea en dos cajas: saldo y cortesía sin doble consumo.
- [ ] Margen de contribución antes y después del descuento trazable.
- [ ] Saldo Loyverse migrado conciliado con libro de movimientos antes de canjear.

### Precaución fiscal y contable

La calificación de puntos como descuento o medio de pago y la base gravable
para IVA/RESICO requiere criterio contable validado. El simulador ofrece solo
importe operativo, no calcula CFDI ni tratamiento fiscal de los canjes.
