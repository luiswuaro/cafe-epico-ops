# Café Épico OPS · impresión automática QA, prueba E2E controlada

**Alcance:** sólo rama `feat/local-selfhost-qa-bootstrap` y .env.local de QA, con
`OPS_QA_MODE=true`, `POS_LIVE_ENABLED=false` y organización `cafe-epico-qa`.
Sin clientes reales. La impresora es POS-58 USB de 58 mm a través del puente local 9137.

## Qué verifica

Un pedido ficticio `SHADOW` de importe `$0.00` (folio `QA-PRINT-*`,
nota técnica `QA_PRINT_SMOKE_TEST_ONLY`, estado `SENT`, sin paid_at,
ni efectos de inventario o puntos) entra en el feed de impresión, se
reclama una vez por transacción, llega al puente y se registra como DONE
o FAILED. **No significa que el POS comercial ya pueda cobrar.**

La excepción en `hub-actions.ts` sólo se aplica a ese fixture exacto bajo
las banderas QA locales. Las órdenes SHADOW normales siguen fuera de la cola.
El camino LIVE existente mantiene la lógica anterior.

## Secuencia en Windows

1. Cerrar **sólo** la ventana del agente QA y la ventana de **Next.js QA**
   con Ctrl+C. Mantener Docker, Postgres, Caddy y el puente POS-58.
   No tocar el servidor comercial.
2. En PowerShell, desde `C:\Users\inicio\Documents\GitHub\cafe-epico-ops-qa`:

   ```powershell
   git pull --ff-only origin feat/local-selfhost-qa-bootstrap
   node --check scripts/local/test-qa-autoprint-once.mjs
   node scripts/validate-qa-autoprint.mjs
   npm.cmd run typecheck
   npm.cmd run validate:structure
   ```

   Si cualquier validación falla: **detenerse y compartir el error**.
3. Iniciar servidor QA en una ventana independiente:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\local\start-qa.ps1"
   ```

   Esperar `Ready` después del build. No usar `-SkipBuild`.
4. Iniciar el agente QA **después** de Next.js, en otra ventana:

   ```powershell
   node --env-file=.env.local scripts/local/print-agent.mjs
   ```

   No cerrar esa ventana. Esperar unos segundos para que aparezca un latido.
5. En otra PowerShell, inspeccionar **sin escribir**:

   ```powershell
   node --env-file=.env.local scripts/local/test-qa-autoprint-once.mjs --check
   ```

   Requiere `PASS` del agente, puente y DB. En este punto **no imprime**.
6. **Sólo una vez**, con papel cargado y a la vista:

   ```powershell
   node --env-file=.env.local scripts/local/test-qa-autoprint-once.mjs --create-once
   ```

   Crea la orden de ensayo, **no cobra**. El agente debe imprimir
   una única `COMANDA DE PRUEBA` / `NO PREPARAR NI COBRAR`.
7. Después de 5-15 segundos, inspeccionar el estado:

   ```powershell
   node --env-file=.env.local scripts/local/test-qa-autoprint-once.mjs --status
   ```

   Resultado deseado: `CLAIM=1 DONE=1 FAILED=0 EXPIRED=0 PAGOS=0 PUNTOS=0`.
   También confirmar físicamente **un solo papel legible**.

## Manejo de fallas

- Si `--create-once` informa error, **no ejecutarlo de nuevo**. La
  reserva persistente `.local/qa-autoprint-e2e.once` se crea antes del INSERT.
  Revisar primero `--status`.
- Si `CLAIM=1` pero `DONE=0`, tratar como impresión ambigua.
  Revisar papel y eventos; **no liberar el CLAIM ni reenviar**.
- Si no aparece una comanda, revisar la terminal del agente y la salud
  del puente, sin repetir `--create-once`.
- Para detener la impresión automática QA: Ctrl+C **en la ventana del agente**.
  Esto no afecta al puente USB ni a PostgreSQL.
- No borrar el marcador `.once` para forzar una segunda prueba.
  Si otra prueba fuera necesaria, crear un nuevo procedimiento aprobado.

## Pendiente para operación comercial

La validación anterior ejercita el circuito
**PostgreSQL QA → feed → claim → agente → puente POS-58 → DONE**.
No comprueba todavía el alta de órdenes mediante la pantalla POS,
cobros reales, cuentas divididas, descuentos, integración con clientes,
inventario ni recuperación tras cortes de luz. Requieren pruebas
independientes y conciliación antes de migrar desde la instalación comercial.
