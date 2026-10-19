# Café Épico OPS — arranque invisible en Windows (SOLO QA)

Estado: scripts versionados y comprobados en CI; **la tarea aún no se ha instalado en la PC**. Este piloto no sustituye el POS comercial.

## Alcance y arquitectura

- Una tarea gratuita del Programador de tareas: `CafeEpicoOps-QA-Server`.
- Al **iniciar sesión** con el usuario Windows configurado, ejecuta un supervisor de PowerShell **oculto**. No quedan consolas visibles ni hay que iniciar Next o Caddy a mano.
- El supervisor comprueba `guard-qa-config.mjs`, inicia los contenedores Supabase QA existentes mediante `start-selfhost-qa.ps1` (Docker Compose sin borrar datos), luego Caddy en la IP LAN configurada y Next.js solamente en `127.0.0.1:3000`.
- Si Docker tarda en iniciar o el servidor termina, comprueba de nuevo cada ~20 segundos. **No inicia ventas LIVE ni toca .env.local.**
- Conserva un archivo de estado que registra PID + tiempo de creación, para no detener procesos Windows ajenos. Los registros privados se guardan en `.local/qa-runtime/` (no subirlos a GitHub).
- El agente de impresión es independiente y ya usa `scripts/local/install-print-agent.ps1`. No se instala ni habilita sin consentimiento explícito; el puente POS-58 también debe estar configurado y funcionando.
- La tarea es **de usuario al iniciar sesión**. No es un servicio que arranque antes de iniciar sesión ni que funcione después de cerrar sesión. La PC debe permanecer encendida, con sesión iniciada y Docker Desktop disponible.

## Preparación una sola vez

1. Comprueba que la instalación QA que ya probamos sigue trabajando y que tu rama tiene una compilación Next.js (archivo `.next/BUILD_ID`). Si has cambiado código desde esa compilación, detén antes Next y ejecuta `npm run build` de forma controlada.
2. En Docker Desktop, activa **Start Docker Desktop when you sign in**. Usa un usuario Windows que pueda ejecutar Docker, Node y Caddy.
3. Detén las **ventanas manuales** antiguas de Caddy y Next.js con Ctrl+C. No cierres ni borres Docker, y no ejecutes `docker compose down -v`. Asegúrate de que los puertos 3000 y 8443 estén libres.
4. Confirma que el archivo `.env.local` sigue siendo **únicamente QA**, con `POS_LIVE_ENABLED=false`. El instalador verifica esas condiciones y detiene la instalación si fallan.
5. Desde la raíz del repositorio, ejecuta:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\manage-qa-runtime.ps1 -Action Install -StartNow
```

Espera 2 a 3 minutos la primera vez. No necesitas dejar abierta la consola que ejecutó el instalador.

## Control (solo cuando lo necesites)

```powershell
# Revisar tarea, Next.js y mensajes sin credenciales
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\manage-qa-runtime.ps1 -Action Status

# Arrancar el supervisor oculto
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\manage-qa-runtime.ps1 -Action Start

# Detener exclusivamente los procesos supervisados (conserva Docker)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\manage-qa-runtime.ps1 -Action Stop

# Quitar el arranque automático sin borrar datos
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\manage-qa-runtime.ps1 -Action Uninstall
```

El instalador requiere una compilación previa. El supervisor utiliza `start-qa.ps1 -SkipBuild`; si actualizas Next.js o el proyecto, detén, recompila, y arranca de nuevo.

## Prueba presencial antes de usarlo en barra

1. Comprueba que `Status` reporta **tarea Running**, Caddy y Next en ejecución y HTTP OK. Revisa `.local/qa-runtime/supervisor.log` si no.
2. Desde la PC abre `http://127.0.0.1:3000/pos` y verifica solo la sesión QA. Desde un teléfono en la misma LAN usa `https://IP_DE_LA_PC:8443/pos`, con la CA confiable instalada en ese teléfono.
3. Haz una prueba de interrupción controlada: reinicia sesión Windows; Docker inicia, el supervisor debe recuperar Caddy/Next sin consolas visibles. Prueba también apagar/reiniciar Docker Desktop en un momento sin clientes.
4. Si cambia la IP de la PC, Caddy se negará a escuchar sobre otra dirección; corrige DHCP/configuración primero. Se recomienda reservar la IP de la PC en el router de esa red.
5. Por separado, comprueba el puente de impresión y el estado del agente; ante alerta de impresora inactiva usa impresión/manual y revisa el registro: no forzar reimpresiones duplicadas.

## Límites y seguridad

- **No configura el firewall, ni acceso remoto por Internet**. El Wi-Fi del hotel es una red que no debemos tratar como confiable; sólo permitir dispositivos autorizados y TLS.
- Los guardas actuales dejan `POS_LIVE_ENABLED=false`; no se autorizan ventas reales hasta cerrar reconciliación, respaldos y ensayos presenciales.
- Caddy y Next.js no necesitan una consola visible, pero la tarea programada y sus procesos sí deben permanecer ejecutándose en segundo plano.
- Ni la impresión POS-58 ni las fallas eléctricas se han validado mediante una prueba física de GitHub Actions.
