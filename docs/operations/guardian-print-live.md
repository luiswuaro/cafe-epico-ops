# OPS Guardian V1 — impresión LIVE de Café Épico

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
- Cuando el agente no existe y las dependencias están listas, Guardian inicia
  una instancia. Limita los intentos a **3 por 15 minutos**, separados por
  **90 segundos**, y conserva el historial aun si se reinicia Guardian.
- Si el agente está vivo pero su latido no llega, Guardian **no lo mata**:
  podría estar en medio de una impresión. El POS conserva su alerta de
  impresión no disponible y los logs señalan revisión humana.
- Un trabajo anterior al arranque **no se reimprime automáticamente**.
  Reconciliar comandas pendientes una a una desde el POS tras verificar el papel.
- El supervisor de ventana/puente existente (`CafeEpicoOps-StationWatchdog`)
  sigue funcionando como antes. Guardian solo intenta iniciar tareas de puente
  registradas y no deshabilitadas cuando están detenidas.
- Inicia **al iniciar sesión Windows** con el usuario que lo instala; requiere
  ese inicio de sesión. No convierte la PC en servicio sin usuario activo.

## Archivos

- `scripts/local/Instalar-OPS-Guardian.ps1`: instalador, supervisor y rollback.
- `scripts/local/print-guardian-health.mjs`: diagnóstico sin imprimir ni mutar BD.
- `scripts/local/print-guardian-core.mjs`: guardas y reglas de latido.
- `scripts/local/print-guardian-core.test.mjs`: pruebas unitarias puras.

## Instalar (cuando los archivos estén en el repositorio LIVE local)

Abrir **una** consola PowerShell normal, con el usuario de operación:

```powershell
& "$env:USERPROFILE\Documents\GitHub\cafe-epico-ops-live\scripts\local\Instalar-OPS-Guardian.ps1"
```

El instalador exige `POLL` HTTP 200, PostgreSQL LIVE y puente ESC/POS válido.
Si no pasan los controles, **no toca las tareas**. Antes de deshabilitar la
tarea anterior `CafeEpicoOps-LIVE-PrintAgent`, exporta su XML a
`%LOCALAPPDATA%\CafeEpicoOps\Guardian`. La tarea previa se deja registrada;
no se borra ni se detiene el agente que ya esté imprimiendo. Si falla la
instalación de Guardian, el instalador intenta restaurar el estado previo.

La nueva tarea `CafeEpicoOps-LIVE-Guardian` usa `MultipleInstances IgnoreNew`,
inicio después de login, `StartWhenAvailable` y tres reintentos de Task Scheduler
ante fallo del supervisor. Aparte, el propio supervisor verifica cada 30 s
el estado del agente y el latido.

## Diagnóstico y reversión

```powershell
& "$env:USERPROFILE\Documents\GitHub\cafe-epico-ops-live\scripts\local\Instalar-OPS-Guardian.ps1" -Status
```

```powershell
& "$env:USERPROFILE\Documents\GitHub\cafe-epico-ops-live\scripts\local\Instalar-OPS-Guardian.ps1" -Uninstall
```

La desinstalación retira la tarea Guardian y vuelve a habilitar la tarea
anterior si estaba habilitada. No borra los registros, los respaldos ni
interrumpe un proceso LIVE de impresión que esté en marcha.

Los registros se encuentran en `%LOCALAPPDATA%\CafeEpicoOps\Guardian\`:
`guardian.log`, `launch-history.json` y `live-*.out.log` / `live-*.err.log`.
No deben contener tokens, contraseñas ni datos del cliente.

## Pruebas de aceptación en Windows LIVE

1. Instalación: preflight aprobado; una sola tarea Guardian en ejecución;
   tarea anterior respaldada y deshabilitada; comanda real nueva sale una vez.
2. Reiniciar Windows e iniciar sesión con el usuario operativo: tras esperar
   el arranque de Docker/OPS, `-Status` muestra latido reciente, API y puente OK.
3. Detener de forma controlada **solamente el agente LIVE** mientras no imprime:
   Guardian detecta ausencia, lo inicia y el latido se recupera.
4. Desconectar USB: el POS anuncia que no hay puente; Guardian no genera
   impresiones ni registra trabajos `DONE` ficticios.
5. Reconectar USB y comprobar una nueva comanda. Las anteriores requieren
   revisión manual antes de solicitar copia.
6. Provocar una caída de PostgreSQL: Guardian no inicia agentes adicionales;
   cuando vuelva la pila local, admite un arranque controlado.
7. Revisar `guardian.log` y comparar con los estados reales del POS.

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
