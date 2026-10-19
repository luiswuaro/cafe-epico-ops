# Café Épico — ensayo espejo local, PC y Azucena
**Fecha: 17 de octubre de 2026. Solo QA, sin corte productivo.**

## Estado real

El código local, migraciones, recuperación cifrada, tickets Unicode y pruebas de
PostgreSQL se trabajan en la rama `feat/local-selfhost-qa-bootstrap`.
**El sistema comercial continúa en Vercel + Supabase.** No hay todavía
un servidor instalado/operando físicamente ni acceso confirmado de los teléfonos.
La palabra «espejo» significa una **segunda instalación aislada con datos
ficticios**: NO significa duplicar operaciones comerciales simultáneamente.

## Qué puede probarse ANTES de tener antena

- Correr diagnóstico Windows desde una **carpeta separada** del POS comercial.
- Preparar Docker Desktop, Node 22, Caddy y pila Supabase Auth/PostgreSQL QA.
- Poner credenciales nuevas en `.env.local` y `.local/supabase-qa/.env`.
- Arrancar la réplica por la IP privada de la PC (puede ser interfaz USB,
  aunque ese enlace aún no sea accesible desde los celulares).
- Probar Chrome de **la propia PC** y el sistema Auth de QA.
- Probar puente de impresión **solo si la operación comercial no se afecta**.
- Crear y restaurar respaldo QA; jamás copiar backup cifrado al mismo disco
  como único respaldo comercial.

## Primera instalación (no automática)

1. No cambiar de rama en la carpeta desde donde cobra el POS comercial.
   Crear la carpeta `cafe-epico-ops-qa` con clone de la rama QA, o usar
   una carpeta QA existente y actualizada.
2. Hacer doble clic en `CafeEpico-QA-Diagnostico.cmd` (solo lectura).
   Corregir los faltantes; no continuar si Docker no funciona.
3. Seguir `docs/operations/selfhost-qa-bootstrap.md`. Ejecutar
   `scripts/local/bootstrap-selfhost-qa.ps1` **solo una vez**;
   configurar secretos nuevos de Auth/JWT y PostgreSQL.
4. Preparar `.env.local` desde la plantilla
   `.env.local-first.example`. No enviar contraseñas ni capturas con
   claves. Habilitar DNS/IP privada y CA pública de Caddy.
5. Hacer doble clic en `CafeEpico-QA-Iniciar.cmd` para iniciar
   **solo la réplica QA**. Este lanzador exige claves correctas y bloquea
   conexiones cloud. Inicia Docker QA, aplica migraciones, agrega plantilla
   de cierre, arranca Caddy y Next.js en ventanas independientes.
6. Esperar a que la ventana Next.js diga que el servidor está listo.
   En la PC QA ejecutar:

   ```powershell
   node --env-file=.env.local scripts/local/qa-smoke.mjs
   ```

7. Abrir en Chrome de la PC `https://IP_PRIVADA_PC:8443/qa/pos-preview`.
   La CA de Caddy debe estar confiada. El panel muestra QA claramente.
   Si no abre, **no** ignorar errores de certificado ni desactivar TLS.

**Límites del lanzador:** no instala Docker/Caddy, no genera JWT/contraseñas
ni crea usuarios Auth, no instala el puente Windows y no activa cobros
reales. Son preparativos explícitos previos para evitar riesgos.

## Azucena: ingreso y checklists

1. El administrador crea una cuenta de correo y contraseña **exclusiva del
   Auth local** para la prueba. No reutilizar un token ni copiar tablas
   `auth.users` del sistema comercial. El usuario debe existir en la DB
   Auth local y tener UUID válido.
2. En la carpeta QA, con la variable `DATABASE_URL` local:
   ```powershell
   node --env-file=.env.local scripts/local/link-qa-employee.mjs --user UUID_LOCAL_AUTH --role BARISTA
   ```
   Si falla, revisar Auth y plantilla QA; no modificar datos comerciales.
3. Entrar con la cuenta en Chrome/Android a
   `https://IP_PRIVADA_PC:8443`; opcional «Añadir a pantalla de inicio».
4. Abrir **Apertura** `/checklists`, **Entrega** `/handoff`,
   **Cierre QA** `/closing`. Cada tarea tiene inicio, registro y
   finalización auditada; las notas de cierre se guardan en PostgreSQL.
5. Confirmar que no tiene `admin.access`, `financial.read` ni
   `checklist.manage`. El barista no debe ver reportes financieros.
   El historial de tickets/cajas mantiene sus bloqueos existentes.
6. Las **fotos de evidencia** todavía NO están integradas al flujo de
   checklists locales. No marcarlas como probadas ni inventar archivos.
7. Verificar que apertura diga **OPS**, nunca Loyverse.

## Impresión local en espejo

0. Para comprobar la conexión del puente sin gastar papel, hacer
   doble clic en `CafeEpico-QA-VerImpresora.cmd`. Únicamente consulta
   `GET /status` de cada puerto 127.0.0.1 con su token QA; no dispara
   ninguna impresión ni muestra credenciales.
1. Ejecutar el puente ESC/POS ya previsto en
   `docs/operations/local-print-agent.md`, ligado solo a
   `127.0.0.1`. Usar únicamente la impresora de pruebas o una
   ventana operativa aprobada para no duplicar comandas comerciales.
2. Preparar tokens de impresora separados del token del agente.
3. Dejar `NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED=false`
   hasta que el agente y puente estén comprobados. Configurar `true`
   únicamente para el ensayo autónomo QA y reiniciar Next.js.
4. Verificar salud del puente local. Iniciar el agente
   `node --env-file=.env.local scripts/local/print-agent.mjs`
   en la PC QA. No hace falta ninguna pestaña del navegador para el
   proceso de impresión.
5. Crear una comanda sintética **$0** DESPUÉS de arrancar el agente:
   ```powershell
   node --env-file=.env.local scripts/local/create-print-agent-qa-order.mjs --print-qa-fixture
   ```
   Verificar una sola impresión, acentos, notas, logo y estado DONE.
   Si hay spool ambiguo, **no** reimprimir automáticamente.
6. Probar recepción desde dos teléfonos después de confirmar LAN
   (antena/hotel). Sin LAN, se puede probar desde Chrome de la PC.

## Autorización final (NO realizada)

- 2 celulares llegan a la PC usando Wi-Fi local con datos móviles apagados.
- Auth local, permisos Azucena y checklists funcionan en celulares.
- POS QA: abrir mesa, enviar comanda, ronda, dividir cuentas, puntos,
  efectivo y transferencia sintéticos, sin ninguna venta comercial.
- Puente: comanda/ticket físicos correctos y no duplicados.
- Cortar solo WAN, conservar Wi-Fi local, comprobar POS + Auth + impresión.
- Restaurar respaldo cifrado en otra máquina/volumen y conciliar puntos,
  pagos, caja, inventario y usuarios Auth; fotos de evidencia pendientes.
- Corte de datos reales requiere inventario inicial, conciliación y rollback.

**No autorizar una migración comercial solamente porque GitHub CI está verde.**
