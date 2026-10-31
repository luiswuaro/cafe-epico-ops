# OPS Guardian V4 — impresión LIVE de Café Épico

Guardian cuida el proceso `scripts/local/print-agent.mjs` después de iniciar sesión
en Windows. Está separado de QA y de la aplicación web. No abre ventanas del POS,
no crea ventas y no imprime comandas por sí mismo.

## Alcance y límites

- Únicamente la pila **LIVE TEPEXI** (`OPS_LOCAL_FIRST=true`,
  `OPS_QA_MODE=false`, `POS_LIVE_ENABLED=true`, PostgreSQL loopback `15432/16544`).
- El estado de impresión proviene de `public.pos_print_station_status`, leído
  con una conexión de PostgreSQL local de solo lectura lógica (consulta SELECT).
- La sonda comprueba la API autorizada con `POLL`, sin `CLAIM`, `FINISH`,
  `ACK` ni `HEARTBEAT`; comprueba `/status` del puente, pero no llama `/print`.
- Cuando el agente no existe y las dependencias están listas, Guardian
  **vuelve a ejecutar la tarea de impresión LIVE existente** si su acción ha sido
  verificada. Conserva el supervisor `manage-live.ps1` que ya usa Windows; si
  no existe tarea anterior, puede iniciar el worker directamente. Limita los intentos a **3 por 15 minutos**, separados por
  **90 segundos**, y conserva el historial aun si se reinicia Guardian.
- La tarea `CafeEpicoOps-LIVE-PrintAgent` se reconoce únicamente si lanza
  directamente el worker esperado o el `manage-live.ps1 -Action RunPrint`
  del usuario con el SHA256 revisado el 31-oct-2026. Si cambia, Guardian
  registra `WAITING_LEGACY_TASK_CHANGED` y no intenta usarla.
- Antes de reactivar LIVE, comprueba si la tarea QA de impresión sigue en
  ejecución o existe otro `print-agent.mjs`. En esos casos registra
  `WAITING_QA_TASK_RUNNING` o `WAITING_OTHER_PRINT_AGENT_RUNNING`, sin
  detener procesos ni disputar el dispositivo USB.
- Si el agente está vivo pero su latido no llega, Guardian **no lo mata**:
  podría estar en medio de una impresión. El POS conserva su alerta de
  impresión no disponible y los logs señalan revisión humana.
- Un trabajo anterior al arranque **no se reimprime automáticamente**.
  Reconciliar comandas pendientes una a una desde el POS tras verificar el papel.
- El supervisor de ventana/puente existente (`CafeEpicoOps-StationWatchdog`)
  sigue funcionando como antes. Guardian solo intenta iniciar la tarea del puente
  cuyo `/status` no responde correctamente, si la tarea está registrada y habilitada;
  limita estos intentos a uno cada 2 minutos. No reinicia un puente sano.
- Durante la instalación, si los demás servicios LIVE están listos pero falla
  un puente, se intenta iniciar exclusivamente su tarea registrada y se vuelve
  a comprobar el estado antes de aceptar la instalación.
- Inicia **al iniciar sesión Windows** con el usuario que lo instala; requiere
  ese inicio de sesión. No convierte la PC en servicio sin usuario activo.

## Archivos

- `scripts/local/Instalar-OPS-Guardian.ps1`: instalador, supervisor y rollback.
- `scripts/local/print-guardian-health.mjs`: diagnóstico sin imprimir ni mutar BD.
- `scripts/local/print-guardian-core.mjs`: guardas y reglas de latido.
- `scripts/local/print-guardian-core.test.mjs`: pruebas unitarias puras.
- `scripts/local/print-guardian-task-policy.ps1`: validación estricta de la
  tarea Windows actual, incluyendo la huella del supervisor entregado.
- `scripts/local/print-guardian-task-policy.windows.test.ps1`: casos de
  reconocimiento y rechazo sin tocar el Programador de tareas real.
- `scripts/local/Corregir-Inicio-OPS-LIVE.ps1`: consulta la tarea de inicio
  `CafeEpicoOps-StationWatchdog`. Con `-Apply` solo sustituye el destino antiguo
  `cafe-epico-ops.vercel.app/pos` por `APP_ORIGIN/pos`, si APP_ORIGIN es una IP
  privada HTTPS 8443 asignada a la PC, el puerto escucha y la acción es conocida.
  Respalda primero el XML y no reinicia tareas ni navegadores. No modifica
  preferencias de Chrome, PWA o accesos directos de procedencia desconocida.

## Instalar (cuando los archivos estén en el repositorio LIVE local)

Abrir **una** consola PowerShell normal, con el usuario de operación:

```powershell
& "$env:USERPROFILE\Documents\GitHub\cafe-epico-ops-live\scripts\local\Instalar-OPS-Guardian.ps1"
```

El instalador exige `POLL` HTTP 200, PostgreSQL LIVE y puente ESC/POS válido.
Si no pasan los controles, **no toca las tareas**. La tarea anterior
`CafeEpicoOps-LIVE-PrintAgent` debe coincidir con una acción verificada;
entonces exporta su XML a `%LOCALAPPDATA%\CafeEpicoOps\Guardian` y **la
conserva habilitada**. No borra ni detiene un agente existente.
Si falla la instalación de Guardian, retira únicamente la nueva tarea
que haya creado.

Si una tarea QA está corriendo, Guardian puede quedar instalado pero avisa
que LIVE permanecerá a la espera. Debe revisarse QA antes de imprimir con
LIVE: **no se detiene QA automáticamente**.

La nueva tarea `CafeEpicoOps-LIVE-Guardian` usa `MultipleInstances IgnoreNew`,
inicio después de login, `StartWhenAvailable` y tres reintentos de Task Scheduler
ante fallo del supervisor. Aparte, el propio supervisor verifica cada 30 s
el estado del agente y el latido.

Si se aplica desde el ZIP autónomo, después de instalar Guardian se intenta
corregir la dirección de la tarea de inicio antigua **solo si coincide con el
destino conocido de Vercel**. Si la acción es distinta, se conserva sin cambios.
Si esta auditoría da error, Guardian permanece instalado y aparece un aviso.

## Diagnóstico y reversión

```powershell
& "$env:USERPROFILE\Documents\GitHub\cafe-epico-ops-live\scripts\local\Instalar-OPS-Guardian.ps1" -Status
```

```powershell
& "$env:USERPROFILE\Documents\GitHub\cafe-epico-ops-live\scripts\local\Instalar-OPS-Guardian.ps1" -Uninstall
```

La desinstalación retira la tarea Guardian. Conserva sin cambios la tarea
LIVE previa. No borra los registros, los respaldos ni
interrumpe un proceso LIVE de impresión que esté en marcha.

Los registros se encuentran en `%LOCALAPPDATA%\CafeEpicoOps\Guardian\`:
`guardian.log`, `launch-history.json` y `live-*.out.log` / `live-*.err.log`.
No deben contener tokens, contraseñas ni datos del cliente.

## Pruebas de aceptación en Windows LIVE

1. Instalación: preflight aprobado; una sola tarea Guardian en ejecución;
   tarea anterior respaldada, verificada y conservada; comanda real nueva sale una vez.
2. Reiniciar Windows e iniciar sesión con el usuario operativo: tras esperar
   el arranque de Docker/OPS, `-Status` muestra latido reciente, API y puente OK.
3. Detener de forma controlada **solamente el agente LIVE** mientras no imprime:
   Guardian detecta ausencia, solicita el arranque de la tarea LIVE y el
   latido se recupera. No probar con trabajo pendiente ni en impresión.
4. Desconectar USB: el POS anuncia que no hay puente; Guardian no genera
   impresiones ni registra trabajos `DONE` ficticios.
5. Reconectar USB y comprobar una nueva comanda. Las anteriores requieren
   revisión manual antes de solicitar copia.
6. Provocar una caída de PostgreSQL: Guardian no inicia agentes adicionales;
   cuando vuelva la pila local, admite un arranque controlado.
7. Revisar `guardian.log` y comparar con los estados reales del POS.
8. Simular QA activo: Guardian no inicia otro worker; registrar el estado de
   espera sin detener QA ni emitir papel.

## Verificación disponible fuera de Windows

```bash
node --test scripts/local/print-guardian-core.test.mjs
node --check scripts/local/print-guardian-health.mjs
node scripts/local/print-guardian-health.mjs --mode=preflight
```

La última invocación sin `.env.local` LIVE debe reportar
`CONFIG_NOT_LIVE` sin intentar conexiones. Las tareas Windows, reinicio real,
latido de PostgreSQL local del usuario y papel físico **no se pueden validar
fuera de su PC**.
