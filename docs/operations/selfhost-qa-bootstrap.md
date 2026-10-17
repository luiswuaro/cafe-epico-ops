# Café Épico OPS · réplica QA local (Windows)

**Estado de esta entrega:** automatización de PREPARACIÓN, verificadores y migrador QA.
No se ha instalado nada en la PC de Café Épico. No es un corte de producción
ni un sustituto de los respaldos y pruebas presenciales.

## Diseño

Se reutiliza el OPS actual (Next.js 16, Drizzle/PostgreSQL y Supabase Auth).
La misma aplicación y sus rutas siguen funcionando contra **una pila Supabase
autoalojada y exclusiva de QA**, sin consumir la base de producción.

```text
PC Windows
├── Caddy TLS (futuro, IP LAN :8443) ─┬─ Next.js 127.0.0.1:3000
│                                   └─ Supabase Auth/API 127.0.0.1:8000
├── Docker Desktop / Supabase self-hosted (release fijado)
│   └── PostgreSQL y Supavisor 127.0.0.1:5432 / 6543
└── .local/supabase-qa/ (configuración privada, fuera de Git)
```

En producción futura, sólo el proxy HTTPS de OPS debe ser accesible para los
terminales autorizados en LAN; PostgreSQL, Supabase Studio/API sin proxy y el
puente de impresión permanecen en loopback. El Wi-Fi del hotel es **no confiable**.
Un túnel remoto para propietarios requiere diseño separado y autenticación MFA.

## Antes de empezar

- Windows con Docker Desktop/WSL2, Node 22+, Git, Docker Compose >= 2.24.4.
- Disco libre y RAM auditados con `scripts/local/check-windows.ps1`; recomendación
  oficial de Supabase self-host: 8 GB RAM y 80 GB SSD como referencia.
- Cuenta Windows con acceso controlado; carpeta .local excluida de Git.
- Claves oficiales **nuevas** para QA; no copiar credenciales Supabase.com.
- No usar cuentas, clientes, puntos ni ventas reales durante el ensayo.

## 1. Descargar una copia oficial y aislada

Desde PowerShell, en la carpeta del repositorio de OPS:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\bootstrap-selfhost-qa.ps1
```

El comando:
1. Comprueba contexto Docker local y versión de Compose.
2. Descarga por sparse checkout el directorio `docker/` del release oficial
   `self-hosted/v0.8.2` (no una versión mutable `latest`).
3. Lo copia a `.local/supabase-qa`, guarda la versión y añade el override
   `docker-compose.ops-qa.yml`.
4. Prepara `.env` **de muestra** y termina. No inicia contenedores.

El archivo `.env` se debe completar con claves reales antes de arrancar.
No sobreescribir un directorio QA existente. **No ejecutar `reset.sh`**
ni `docker compose down -v`.

## 2. Generar claves y configurar Supabase QA

Usar Git Bash (o un shell POSIX controlado) y las herramientas `openssl`,
`jq` requeridas por los generadores oficiales, en
`.local/supabase-qa`:

```bash
sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh
```

Revisar que dichos scripts terminen correctamente y que las claves demo
hayan sido sustituidas. No compartir el archivo resultante `.env`.

Editar ese **único archivo local**:

```dotenv
COMPOSE_FILE=docker-compose.yml
POOLER_TENANT_ID=cafe-epico-qa
SUPABASE_PUBLIC_URL=https://IP_PRIVADA_PC:8443
API_EXTERNAL_URL=https://IP_PRIVADA_PC:8443/auth/v1
SITE_URL=https://IP_PRIVADA_PC:8443
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=true
ENABLE_PHONE_SIGNUP=false
ENABLE_ANONYMOUS_USERS=false
```

Sustituir IP_PRIVADA_PC por la IP LAN efectiva. Las claves privadas no van en
variables `NEXT_PUBLIC_*`. Conservar las claves de servicio únicamente
en el servidor.

La plantilla `.env.local-first.example` del OPS se copia a `.env.local`
**en el equipo**, fuera de Git. Apuntar `DATABASE_URL` al Supavisor QA en
loopback; respetar el usuario de sesión documentado por Supabase self-host
(`postgres.<POOLER_TENANT_ID>`) y la contraseña generada. Asignar
`NEXT_PUBLIC_SUPABASE_ANON_KEY` a la misma
`SUPABASE_PUBLISHABLE_KEY` local. Usar:

```dotenv
OPS_LOCAL_FIRST=true
OPS_QA_MODE=true
POS_LIVE_ENABLED=false
DEFAULT_ORGANIZATION_SLUG=cafe-epico-qa
DEFAULT_STORE_CODE=QA-TEPEXI
NEXT_PUBLIC_SUPABASE_URL=https://IP_PRIVADA_PC:8443
APP_ORIGIN=https://IP_PRIVADA_PC:8443
```

El validador prohíbe claves demo, habilitar altas públicas o divergencia entre
el origen de la aplicación y la API de Auth. Si falla, **no se inicia** la pila.

### Enlace automatizado de secretos (sin copiar contraseñas)

Una vez ejecutados `sh utils/generate-keys.sh --update-env` y
`sh utils/add-new-auth-keys.sh --update-env`, **desde la raíz del repositorio**
ejecutar el siguiente comando, cambiando la IP por la que figura en la
prueba LAN:

```powershell
node scripts/local/configure-qa-env.mjs --ip 192.168.0.172
```

Se crea `.env.local` por primera vez y se actualiza
`.local/supabase-qa/.env` sin revelar contraseñas en consola. La herramienta
impide sobrescribir un `.env.local` existente, rechaza configuraciones
que apunten a la nube, y deshabilita el registro público de Auth QA.
`OPS_LOCAL_CA_FILE` se prepara con una ruta candidata de Caddy basada en
`%APPDATA%`; se debe **verificar su existencia y contenido** una vez
instalado/ejecutado Caddy. Este paso NO arranca los servicios ni
autoriza el acceso desde móviles.

En caso de que ya exista `.env.local`, no borrar el archivo por costumbre:
revisar la configuración con el operador para no perder secretos existentes.

**Precaución:** la versión oficial de los scripts de claves puede dejar
respaldos `.env.old` con secretos temporales en
`.local/supabase-qa/`. Mantener toda la carpeta privada y excluida de Git,
y destruir las copias obsoletas solo después de comprobar la configuración
actual. Nunca enviar el contenido de ningún `.env` por chat.

## 3. Arrancar la pila QA con acceso sólo desde la PC

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\start-selfhost-qa.ps1
```

Antes de `docker compose up`, ejecuta:

- `guard-qa-config.mjs`: conexiones OPS exclusivamente locales/QA.
- `inspect-qa-secrets.mjs`: claves nuevas y orígenes consistentes.
- `inspect-qa-compose.mjs`: **todos los puertos publicados** limitados a
  `127.0.0.1` / `::1`. Si el puerto 8000, 5432 o 6543 se publica hacia el
  hotel, bloquea el arranque.

El override usa `!override` para sustituir, no añadir, los puertos del
archivo base (requiere Compose 2.24.4+). Docker Desktop no debe apuntar a un
daemon remoto. Verificar `docker compose ps` antes de migrar.

### Reparación puntual si Windows tiene ocupado `127.0.0.1:6543`

En Windows, el primer `up --wait` puede iniciar PostgreSQL y otros servicios,
pero fallar al publicar el puerto **host 6543** de Supavisor. **No ejecutar
`docker compose down -v` ni detener procesos de Windows a ciegas**.

El OPS se conecta al Supavisor modo sesión por `127.0.0.1:5432`;
para transacciones remapeamos **solo** el puerto del host a `16543`,
conservando el interno 6543. Para una instalación ya preparada antes de
este cambio, tras `git pull --ff-only`, desde la raíz QA ejecutar:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\\scripts\\local\\repair-qa-transaction-port.ps1"
```

El reparador sólo acepta el guard de QA local, comprueba por TCP que
`127.0.0.1:16543` se pueda reservar, cambia únicamente el override
ignorado por Git `.local/supabase-qa/docker-compose.ops-qa.yml`, verifica
con `docker compose config` y `inspect-qa-compose.mjs` los puertos
loopback y restaura el override original si la validación falla.
**No cambia `.env.local`, claves, volúmenes, PostgreSQL ni puertos WAN**.

Al recibir `PASS`, reintentar `start-selfhost-qa.ps1`, que será
idempotente y levantará los contenedores existentes. Si 16543 también
está ocupado, el reparador aborta sin cambios; primero identificar el
conflicto y seleccionar un puerto alternativo con `-HostPort` explícito.
No improvisar puertos en la URL de Auth/OPS.

### Reparación puntual: «Email logins are disabled»

En el release autoalojado, `ENABLE_EMAIL_SIGNUP=false` desactiva el proveedor
de correo y también el inicio de sesión con contraseña, incluso de usuarios ya
creados por Studio. QA debe tener `ENABLE_EMAIL_SIGNUP=true` **junto con**
`DISABLE_SIGNUP=true`, de modo que Auth admita el login por email pero
bloquee el autoregistro público. Se mantiene `ENABLE_PHONE_SIGNUP=false`
y `ENABLE_ANONYMOUS_USERS=false`.

Si esta QA fue configurada con la versión anterior, actualizar únicamente
`ENABLE_EMAIL_SIGNUP` a `true` en `.local/supabase-qa/.env` (archivo
privado ignorado por Git). Validar con
`node scripts/local/inspect-qa-secrets.mjs .env.local .local/supabase-qa/.env`.
Después, desde `.local/supabase-qa`, recrear **solo** el servicio Auth con
los dos Compose del piloto:

```powershell
docker compose -f docker-compose.yml -f docker-compose.ops-qa.yml up -d --no-deps --force-recreate --wait auth
```

No recrear la base, no generar claves nuevas ni cambiar `DISABLE_SIGNUP`.
Comprobar el inicio de sesión QA antes de migrar cualquier venta.

## 4. Crear el esquema OPS y los datos sintéticos de prueba

Con el servidor QA levantado, desde la raíz OPS:

```powershell
node --env-file=.env.local scripts/local/apply-qa-schema.mjs --seed-qa
```

- Ordena las migraciones `db/migrations/*.sql` por nombre.
- Cada archivo se aplica en transacción y queda registrado con SHA-256 en
  `public.ops_local_migrations`.
- Una migración modificada después de aplicarse bloquea el proceso.
- Si encuentra tablas previas sin historial, aborta (no las sobrescribe).
- El seed derivado de `db/seed.sql` cambia identificadores lógicos a
  `cafe-epico-qa` y `QA-TEPEXI`, nunca importa ventas ni puntos reales.
- El QA sólo acepta `POS_LIVE_ENABLED=false` en esta etapa.

**No usar esta secuencia para restaurar producción.** Un traslado real de
`auth`, `storage` y `public` requiere un respaldo cifrado íntegro y prueba
de restauración independiente.

### Reparación QA: falta la copia del catálogo OPS

La migración 0028 crea el snapshot para organizaciones ya existentes, pero
el seed `--seed-qa` agrega `cafe-epico-qa` después. En el primer inicio
de sesión se detecta la ausencia de snapshot y `/today` falla con
«Falta la copia del catálogo en OPS».

Desde la raíz QA, después de `git pull --ff-only`, ejecutar:

```powershell
node --env-file=.env.local scripts/local/repair-qa-catalog-snapshot.mjs
node --env-file=.env.local scripts/local/qa-smoke.mjs --db-only
```

Este reparador valida aislamiento QA, ventas LIVE deshabilitadas y base
sin organizaciones comerciales. Inserta una sola fila estructural
de archivo vacío sin borrar, copiar ni sobrescribir datos comerciales.
**No carga productos ni habilita ventas**: el menú QA sigue pendiente.
Si ya existe la fila con JSON válido, no la sobrescribe.

Para liberar el flujo `/today` después de la reparación, reiniciar
Next.js únicamente si persiste el error debido a caché. Conservar Caddy,
Docker, Auth, migraciones y datos QA.

Antes de simular operaciones POS, cargar un catálogo de ensayo nativo,
validar recetas/empaques/stock y comprobar modo QA sin ventas LIVE.
Para sustituir la operación comercial es imprescindible migrar
catálogo y datos reales mediante respaldo cifrado, restauración
independiente y una ventana de corte autorizada.

## 5. Crear usuario Auth local y vincular al empleado QA

En Studio autoalojado accesible **únicamente desde la PC**, crear un usuario
de prueba. Vincular su UUID real en `public.user_profiles` y en el registro
QA de `public.employees` siguiendo `scripts/link-auth-user.sql.example`.
No copiar los UUID de usuarios del Supabase comercial.

No asignar permisos solo con el campo editable `user_metadata`: el OPS valida
empleado activo y RBAC desde PostgreSQL.

## 6. OPS local + HTTPS LAN (pendiente de red)

La plantilla `infra/local/Caddyfile.example` enruta por la **misma** URL TLS:
`/auth/v1/*` → API de Auth en loopback; el resto → Next.js en loopback.

1. Instalar Caddy de forma local y revisar el archivo Caddyfile.
   `scripts/local/start-qa-gateway.ps1` obtiene la IP directamente de
   `APP_ORIGIN` y comprueba que exista en una interfaz IPv4 activa de la PC.
   Caddy `bind` escucha sólo en esa IP, no en todas las interfaces.
   Iniciar desde otra consola PowerShell:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\start-qa-gateway.ps1
   ```
2. Confiar en la CA local pública de Caddy en los dispositivos propios (jamás
   copiar la clave privada de la CA). No usar HTTP para cobros en el hotel.
3. Iniciar Next.js con `scripts/local/start-qa.ps1`. Antes, configurar
   `OPS_LOCAL_CA_FILE` en `.env.local` con la ruta del certificado público
   raíz `root.crt` que generó Caddy. El script carga esa CA mediante
   `NODE_EXTRA_CA_CERTS`, sin desactivar la verificación TLS. Iniciar Caddy
   al menos una vez para generar el certificado y asegurarse de que la
   CA pública esté confiada en el sistema y terminales propias.
4. Exponer en el firewall solo el puerto HTTPS seleccionado hacia equipos
   permitidos de la LAN. Si el Wi-Fi del hotel aísla clientes, disponer de una
   red privada administrada por la cafetería.

## 7. Pruebas obligatorias antes de migrar la venta real

- Inicio/cierre de sesión de propietario y barista, permisos revocados.
- POS en PC + dos terminales simultáneos; venta ficticia y cuenta dividida.
- Comanda, ronda adicional, reimpresión manual y acuse de impresora.
- Caja, devolución/cancelación, puntos e inventario sin doble efecto.
- Importación de un JSON de HiBean, recetas, SOPs y escandallos.
- Persistencia tras reiniciar Docker/Windows; Internet WAN desconectado.
- Copia cifrada de QA, restauración en una **segunda** instalación aislada.
- Métricas de CPU/RAM, p95 de cobro e impresión, cero errores de inventario.

No se ha ejecutado este conjunto de pruebas físicamente. Hasta completarlo,
**Supabase/Vercel de producción siguen operando sin cambios.**

## Fuente oficial

- https://supabase.com/docs/guides/self-hosting/docker
- https://supabase.com/docs/guides/self-hosting/accessing-postgres
- https://docs.docker.com/reference/compose-file/merge/

## Auditoría de funcionamiento QA

Con la réplica encendida y el esquema cargado, ejecutar:

```powershell
node --env-file=.env.local scripts/local/qa-smoke.mjs --db-only
```

Examina sin modificar: integridad SHA-256 de las migraciones, tablas críticas,
única organización `cafe-epico-qa`, sucursal `QA-TEPEXI`, usuarios de Auth,
ausencia de ventas LIVE y existencia de pedidos de ensayo. Si la base se
contaminó con tablas ajenas o ventas reales, detiene la validación.

Con Caddy y Next.js iniciados, volver a ejecutar **sin** `--db-only`:

```powershell
node --env-file=.env.local scripts/local/qa-smoke.mjs
```

Además prueba con TLS real `/api/health` y `/auth/v1/health`. Si la CA de
Caddy no está confiada por Node, configurar `OPS_LOCAL_CA_FILE` como ruta al
certificado **público** raíz local; no usar `NODE_TLS_REJECT_UNAUTHORIZED=0`.
Solo tras terminar estas pruebas estructurales comenzarán las pruebas con
cobros y papel físicos. Este comando **no crea ventas**.

## Estación Windows para QA local (sin cambiar producción)

La estación actual de caja y puente de impresión utiliza
`tools/print-bridge/Instalar-EstacionOPS.ps1`. Antes apuntaba
obligatoriamente a Vercel. En esta rama acepta explícitamente el HTTPS
privado de la PC, con validación para rechazar dominios arbitrarios.

**Sólo en una PC de pruebas o durante un corte autorizado**, ejecutar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\print-bridge\Instalar-EstacionOPS.ps1 -OpsUrl "https://IP_PRIVADA_PC:8443/pos"
```

La tarea de Windows conservará esa URL al reiniciar e intentará abrirla
una vez al iniciar sesión. La impresora y los tokens no se modifican en la
instalación de la estación. El navegador aún es una dependencia del
procesamiento automático: esto NO implementa un worker de impresión
independiente. Para pruebas QA no usar la PC que actualmente cobra en
producción, porque esta tarea reemplaza la estación instalada de Windows.

## Respaldo local Windows antes de producción

`scripts/local/backup-ops-local.mjs` crea un archivo age cifrado
directamente desde `pg_dump`, sin volcar una copia sin cifrar al disco.
`scripts/local/inspect-ops-local-backup.mjs` verifica SHA-256, age y TOC
con pg_restore, pero **no reemplaza** la prueba de restauración en una
segunda instancia. Instalar pg_dump/pg_restore 17 y age en Windows.
Ver `docs/operations/local-backup-runbook.md`.
