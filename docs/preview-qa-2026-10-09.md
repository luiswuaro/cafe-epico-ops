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
