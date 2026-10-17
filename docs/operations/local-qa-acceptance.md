# Pruebas de aceptación — Café Épico OPS local

**Ambiente:** QA aislado, exclusivamente con ventas, clientes y cuentas ficticias.
**Responsable:** propietario/encargado + técnico en PC y dos móviles.
**Precondición:** Caddy/Next/PostgreSQL/Auth locales y certificados confiados.
**No sirve para certificar producción sin ejecución y evidencias firmadas.**

| Prueba | Ejecución | Aceptación |
|---|---|---|
| QA esquema | `qa-smoke.mjs` | Tablas, hashes y aislamiento correctos |
| Sesión y permisos | Dueño/barista, luego revocar el barista | No puede seguir operando tras revocación |
| Menú y POS | Vender bebida ficticia 12oz y 16oz | Precio, extra y empaque correctos |
| Pagos | Efectivo, tarjeta/transferencia, dividido | 1 cobro por idempotency key, cero duplicados |
| Comandas | Guardar mesa, segunda ronda y marcar LISTO | Folio/ronda/tiempo correctos, estado coherente |
| Impresora | Enviar desde 2 celulares | Una sola comanda física por evento |
| Fallo de impresora | Apagar puente, volver a conectarlo | No imprimir comandas viejas fuera de la política de edad |
| Puntos | Ganar/canjear con cliente ficticio | Saldos y movimientos contables verificables |
| Inventario | Venta y cancelación autorizada | Merma, descuentos y reversas concordantes |
| Caja | Abrir, movimientos, cerrar | Diferencia cuadrada con los cobros |
| Finanzas | Ventas, márgenes y costos por día | Cifras conciliadas con los tickets |
| Tueste | Crear sesión y lote HiBean ficticio | Peso verde/tostado, merma, trazabilidad |
| Sin Internet | Desconectar solamente WAN; mantener LAN | Login vigente, cobro y comanda sin dependencia externa |
| Reinicio | Reiniciar servidor y volver a abrir | Persisten órdenes, saldos y estados impresos |
| Respaldo | `backup-ops-local.mjs` + `inspect-ops-local-backup.mjs` y restauración en otra réplica QA | Coinciden conteos, puntos, cobros, FK y usuarios; copia age SHA válida |

Registrar cada caso con fecha, responsable, evidencia, resultado
(PASA/FALLA) y observaciones. Si una fila crítica falla, no reemplazar el
sistema productivo. El resultado de compilación CI no sustituye las pruebas
de acceso a dispositivos físicos.

El navegador de la estación impresora puede cerrar la pestaña o quedar
suspendido; validar también esa situación. El proceso de impresión del futuro
servidor local debe ser durable e independiente del estado de una pestaña.

**Umbrales iniciales de aceptación (objetivos por medir, no resultados):**
- 0 ventas duplicadas; 0 consumos de inventario duplicados.
- 0 comandas retroactivas automáticas fuera de la política.
- 0 escrituras a la organización comercial desde la QA.
- Registrar p95 de respuesta POS y de impresión con 2 móviles + PC.
- Registrar uso RAM/disco CPU y al menos un ensayo de corte WAN de 30 min.

**El acceso remoto requiere su propia validación de autenticación,
autorización y exposición TLS antes de habilitarse.**
