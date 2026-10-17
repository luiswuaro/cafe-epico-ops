# Café Épico OPS — Agente de impresión local QA (sin navegador)

**Estado:** implementación de prueba. No ejecutar sobre la caja comercial sin
validar y autorizar el corte. Este agente NO está habilitado en producción.

## Objetivo y garantías

El agente `scripts/local/print-agent.mjs` es un proceso Node 22 que puede
ejecutarse en Windows con el POS cerrado. Usa la **misma cola persistida en
PostgreSQL** que el Hub actual. No crea una segunda cola paralela.

Cada impresión sigue este protocolo:

1. Comprobar `/status` del puente RAW ESC/POS en loopback.
2. Consultar los trabajos LIVE de la organización `cafe-epico-qa` usando un
   token secreto exclusivo de la PC, no las cookies del navegador.
3. Rechazar trabajos antiguos y llamar a `CLAIM`: PostgreSQL utiliza una
   transacción con bloqueo por sucursal y audita el dueño del trabajo.
4. Imprimir solo si se obtuvo `claimed=true`.
5. Marcar `DONE` únicamente tras `ok=true` del puente; reportar métrica
   de impresión de comanda después de `DONE`.
6. Si el puente pierde conexión o el acuse es ambiguo, dejar el trabajo como
   `FAILED` o `CLAIMED`; **no hay reintento físico automático**. Un operador
   debe revisar el papel y ordenar una copia extra conscientemente.

Al iniciar, fija `since` a la hora actual para no enviar comandas anteriores
al reinicio. Si se detiene, los trabajos perdidos requieren revisión manual.
No hay promesa de *exactly-once* físico: el spooler Windows y el papel no son
transaccionales. El protocolo garantiza **ausencia de reimpresión ciega**.

## Seguridad

- Ruta `POST http://127.0.0.1:3000/api/local-print-agent`: con token de
  32+ caracteres, validación constante y cuenta QA vinculada a empleado activo
  con permiso `pos.sell` en esa sucursal.
- La ruta rechaza Vercel, fuera de QA, navegador con `Origin` y hosts externos.
- Caddy responde **403** a `/api/local-print-agent*` para dispositivos LAN.
- No exponer directamente el puerto 3000 de Next.js al Wi-Fi del hotel.
- La cuenta de servicio debe ser propia de QA; nunca la identidad del barista
  comercial ni una cuenta con privilegios de administrador innecesarios.
- El token del agente y los tokens del puente son **distintos**, se guardan en
  `.env.local` de Windows (fuera del repositorio y con ACL local).
- Cada operación reutiliza el permiso PostgreSQL y los registros de
  `POS_PRINT_HUB_CLAIMED/DONE/FAILED/EXPIRED` existentes.

## Preparación

Configurar después de instalar Auth, PostgreSQL, Next.js y puente ESC/POS
locales. En el archivo privado `.env.local` de QA agregar:

```dotenv
OPS_LOCAL_PRINT_AGENT_TOKEN=GENERAR_64_CARACTERES_HEXADECIMALES
OPS_LOCAL_PRINT_AGENT_USER_ID=UUID_DE_USUARIO_AUTH_QA_VINCULADO
OPS_LOCAL_TICKET_PRINTER_TOKEN=TOKEN_DEL_PUENTE_WINDOWS_9137
# Opcional: impresora de barra separada
OPS_LOCAL_KITCHEN_PRINTER_TOKEN=TOKEN_DEL_PUENTE_WINDOWS_9138
OPS_LOCAL_TICKET_PRINTER_PORT=9137
OPS_LOCAL_KITCHEN_PRINTER_PORT=9138
```

Generar token independiente con:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

No pegar el token en conversaciones o tickets de soporte. El usuario Auth QA
debe figurar en `public.employees.user_id` y contar con permiso
`pos.sell` en `QA-TEPEXI`.

## Operación manual

1. Dejar Next.js QA escuchando **solo en** `127.0.0.1:3000`.
2. Arrancar el puente con `Install-CafeEpicoPrintBridge.ps1`.
3. Configurar en `.env.local` `NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED=true` y
   reiniciar/reconstruir Next.js QA. Se desactiva el polling del navegador;
   si el agente deja de funcionar no se reactiva solo la pestaña. El equipo
   necesita intervención para evitar impresiones duplicadas.
4. Iniciar en PowerShell:

```powershell
node --env-file=.env.local scripts/local/print-agent.mjs
```

Si se desea registrar una tarea al iniciar sesión **en la PC de pruebas**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\install-print-agent.ps1 -StartNow
```

Para detenerla y desinstalar su tarea (sin eliminar credenciales ni puente):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\install-print-agent.ps1 -Uninstall
```

## Limitaciones antes de producción

- Esta primera versión imprime mediante **texto ESC/POS** y **logo raster**
  opcional guardado en OPS, ambos en el mismo trabajo de Windows. Conserva
  folios, notas, modos de servicio, importes, método de cobro, cliente y
  puntos, pero el cuerpo del ticket todavía NO tiene el diseño raster
  completo de la versión de navegador. Es una diferencia visual que deberá
  resolverse o aprobarse expresamente.
- La tarea requiere sesión Windows iniciada; todavía no es servicio NT
  independiente de inicio de sesión.
- El token de agente está asociado a un empleado QA. Se debe diseñar una
  cuenta de dispositivo con RBAC más restringido antes de producción.
- El puente 1.3.0 acepta los campos `lines` y `logo` en el mismo trabajo.
  Las pruebas de flujo simulan los acuses del puente, no la salida física.
- No existe prueba física con POS-58 ni prueba de corte de luz/WAN.
- Si se usa una sola impresora sin cortador, aplica una pausa de 12 segundos
  entre documentos; medir para optimizar.
- No debe activarse sobre la base comercial ni en un segundo equipo hasta
  ejecutar las pruebas de duplicación, concurrencia y conciliación de papel.

## Pruebas mínimas

- Entregar 2 comandas desde 2 celulares y recibir exactamente 2 tickets.
- Cerrar todas las ventanas del navegador de la PC y repetir el envío.
- Simular impresora desconectada **antes** de reclamar; verificar que no
  quedan trabajos falsamente impresos.
- Simular cierre de proceso después de CLAIM; comprobar que no reimprime.
- Simular pérdida de ACK del spooler después del envío; requerir decisión
  manual para reimpresión.
- Verificar descuentos, cuentas divididas, notas, acentos, barra separada,
  puntos y recibos fiscales no-CFDI.

El tiempo de separación de papel es configurable con `OPS_LOCAL_PRINT_GAP_SECONDS`
(0–30 segundos). Para la POS-58 sin guillotina se mantiene 12 segundos
hasta medir el flujo real; con autocorte puede utilizarse 0.

## Generar una comanda de prueba desde la base QA

Después de iniciar el agente y comprobar las credenciales, se puede
crear **un único pedido ficticio LIVE** directamente en la sucursal QA.
No representa una venta, no registra pago, no descuenta inventario y no
genera movimientos de lealtad. No ejecutarlo en equipos de producción.

```powershell
node --env-file=.env.local scripts/local/create-print-agent-qa-order.mjs --print-qa-fixture
```

Imprime "COMANDA DE PRUEBA" con acentos y una nota de prueba. Validar
que se envía una sola vez, que el agente marca `DONE` y que el
navegador puede permanecer cerrado. El script verifica la organización
y sucursal QA antes de insertar. Generar el pedido **después** de
iniciar el agente: nunca recupera un lote de comandas antiguas sin
confirmación manual.
