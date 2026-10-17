# Café Épico OPS: ejecución LAN local-first, $0 de suscripciones

## Estado verificable

**Fase 1 implementada en código:** diagnóstico seguro de red e inventario no destructivo de Windows. No se ha instalado nada en la PC de Café Épico, ni migrado una venta. Esta etapa NO ejecuta POS.
**Meta:** cobrar y guardar comanda en la LAN sin depender de Supabase/Vercel ni de internet; supervisión y pedidos remotos cuando internet exista; reproducción sin dobles pagos, puntos o papel.

Requisitos reales: PC Windows i7 / 16 GB, equipos en Wi-Fi del hotel; puede existir `AP/client isolation` aun si están en el mismo SSID. Necesitamos confirmarlo con un ensayo desde al menos 2 móviles.

## Fase 1: comprobar LAN en la PC (sin tocar OPS productivo)

1. En la PC de impresión abrir PowerShell en la carpeta clonada de `cafe-epico-ops`.
2. Actualizar el repo con `git pull` cuando el cambio ya esté integrado.
3. Ejecutar, sin permisos de administrador:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\check-windows.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\test-lan.ps1
```

4. La prueba imprime `http://IP-DE-TU-PC:47835/`. Abrir esa URL **solo desde celulares de la misma red del hotel**. La pantalla debe decir `CONEXIÓN LOCAL CONFIRMADA`.
5. Si Windows Firewall la bloquea, ejecutar PowerShell **como Administrador** y repetir:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\test-lan.ps1 -OpenTemporaryFirewall
```

La opción de firewall solo admite tráfico TCP desde `LocalSubnet`; elimina su regla al salir. El servidor de diagnóstico **no tiene acceso** a bases de datos, secretos, tickets o impresoras, y se apaga solo tras 15 minutos. Si se interrumpe el proceso de forma brusca antes de ejecutar `finally`, revisar y quitar cualquier regla `CafeEpico-Temporary-LAN-Probe-*` con el panel de Firewall. La Wi-Fi del hotel se trata como red no confiable.

**No abrir el POS real por HTTP en el hotel.** Las credenciales, cookies y transacciones requieren HTTPS y controles de acceso. El HTTP de esta fase solamente sirve una página inocua.

**Criterio de salida:** la página funciona desde al menos 2 celulares y desde la PC, sin usar datos móviles. Si hay aislamiento AP, necesitamos un router LAN propio (sin necesidad de contratar servicio de internet) antes de instalar la versión de producción.

## Fase 2: réplica local autosuficiente (NO conectar al negocio aún)

La ruta de menor cambio al código actual es **Supabase self-hosted oficial + Next.js self-hosted** en la PC, **sin el proveedor Supabase.com**:
- `PostgreSQL` local para transacciones OPS; conservar 82 tablas, integridad FK, historial y funciones compatibles.
- `Auth` local compatible para roles, sesiones y `getClaims()`. Debe conservar el esquema y permitir verificar firmas. Migrar usuarios con ensayo; posible obligación de reingreso.
- `Next.js` mediante un proceso Node local que llega a PostgreSQL por loopback; no usar Vercel para producción comercial.
- HTTPS local con CA propia y certificado confiado en cada móvil (por ejemplo Caddy `tls internal` con SAN/host local validado). Instalación del certificado público CA mediante procedimiento supervisado, JAMÁS compartir su llave privada.
- PostgreSQL, Auth, Studio y API **NO** publicados a la Wi-Fi del hotel ni a internet; exponer **solo** el puerto HTTPS de OPS a la subred local de caja. Caddy o el proxy debe filtrar rutas administrativas.
- La PC puente de impresión usa su puerto `127.0.0.1`; no exponer el token/bridge a la Wi-Fi.
- El proyecto principal **permanece en Supabase/Vercel** mientras la réplica utiliza exclusivamente datos ficticios o una restauración aislada y protegida.

Supabase recomienda **Docker Desktop Windows** y documenta mínimos 4 GB RAM, 2 CPU, 40 GB SSD; recomendado 8GB RAM, 4CPU, 80GB SSD. Nuestra PC es candidata por memoria, **no está validada en disco, WSL2, red ni estabilidad**. Usar la pila oficial del proyecto `supabase/supabase` con una versión/tag estable fijada y su generación oficial de secretos, no imágenes/tag `latest` ni secretos de prueba.

NO ejecutar `docker compose down -v`, `reset.sh` ni copiar `DATABASE_URL` productiva a la réplica. El respaldo real cifrado sigue pendiente de ejecutar y ensayar.

### Protección automática de la réplica QA (ya incluida en código)

- `.env.local-first.example`: plantilla de variables (sin secretos), apuntando solo a PostgreSQL loopback y Auth HTTPS de una IP privada; cambiar valores tras instalar el stack autoalojado.
- `scripts/local/guard-qa-config.mjs`: verifica antes de arrancar que DB es LOCAL, Auth no es Supabase.com, HTTPS en la LAN, `cafe-epico-qa` y `POS_LIVE_ENABLED=false`. No imprime credenciales ni permite iniciar contra la nube.
- `scripts/local/start-qa.ps1`: valida configuración y **solo levanta Next.js en 127.0.0.1:3000**, detrás de un futuro proxy HTTPS; jamás lo expone por HTTP a los celulares.

Una vez instalado el stack local oficial, configurado Caddy HTTPS y los secretos locales:

```powershell
Copy-Item .env.local-first.example .env.local
# Editar .env.local SOLO con credenciales de la réplica local y su IP/certificado HTTPS.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\start-qa.ps1
```

**Este comando NO funciona todavía sin instalar Docker Supabase, restaurar QA y crear HTTPS.**
No representa migración final ni debe usarse para ingresar ventas reales.

**Pruebas de salida:** login de dueño/barista, revocación de acceso, 2 POS simultáneos, cobranza dividida, puntos, inventario, comandas e impresión, corte de caja, facturación de métricas, persistencia tras reiniciar PC, corte total de WAN, recuperación de copia y reconciliación. Todos con datos ficticios primero.

## Fase 3: métricas y comandas en vivo sin polling masivo

Arquitectura objetivo local:
1. **PostgreSQL transaccional** es única fuente de verdad; una venta confirma en ACID pagos, líneas, consumo, lealtad y eventos de impresión. Identificador de venta UUID e idempotencia.
2. **Outbox local** de eventos de negocio para comanda, recibo y dashboard; añadir solo tras confirmar operación en la misma transacción. El acuse de impresión se guarda en DB y no produce duplicados al reintentar.
3. En el servidor Windows, un worker escucha **PostgreSQL LISTEN/NOTIFY** o una cola local durable y emite **Server-Sent Events (SSE)** desde Next.js self-hosted a los clientes autenticados. NO usar `LISTEN/NOTIFY` como cola durable: cada evento debe permanecer en outbox hasta su acuse.
4. Dashboard: resumen de ventas agrupado por fecha de negocio, tienda, turno, medio de pago y líneas/COGS; refresh inicial y después *solo* al recibir notificación (revisión esporádica de desincronización). Cada navegador NO consulta la BD cada 4–5 s.
5. Recepción móvil remota se autentica igual que LAN y entra a la misma cola de impresión física por sucursal; imprimir en Windows **una sola vez**.
6. Medir p95 de cobro, cola de impresión, mensajes repetidos, uso de RAM, conexiones SQL y total de transferencia WAN por día; en QA, simular 2 celulares + una PC, 30 minutos y caída WAN.

**No introducir triggers en DB productiva antes de simulación y respaldo.** Tampoco hacer caché compartido de saldos de puntos, caja, permisos o precios que invalide transacciones.

## Fase 4: acceso remoto de dueños o segunda sucursal

Candidato: **Cloudflare Tunnel + Access** (Free para equipos pequeños bajo cuotas y condiciones), con dominio y administración de identidad. No requiere exponer `5432` ni abrir puertos en el router del hotel. Un nombre DNS propio puede implicar pago anual, por lo que `$0` de contratación solo se confirma tras definir la solución de dominio/dirección segura.

- Propietarios/admin remotos: permisos granulares. Para recibir **comandas** también desde fuera, usar túnel HTTPS protegido y emisión local de tickets.
- Los celulares dentro del hotel deben resolver el servidor **por LAN incluso sin internet**. El enlace público nunca será una dependencia para cobrar localmente.
- Cuando falle el internet del hotel, el acceso remoto no funcionará, pero los locales sí.
- Rechazar despliegue público sin HTTPS, MFA admins, RBAC de empleados, rate limit, logging auditado y pruebas de sincronización.
- Tailscale Personal y ZeroTier Personal gratis restringen **uso comercial**. No usarlos como solución gratuita para el negocio sin contratar el plan empresarial.
- Vercel Hobby restringe uso comercial aunque esté debajo de cuota: **solo QA/desarrollo no comercial**, no producción de Café Épico.

## Seguridad y fiabilidad mínima antes de dejarlo como POS principal

- Servidor/PC siempre encendido, arranque automático controlado tras corte eléctrico; actualizaciones Windows fuera de horario y reserva de energía/UPS cuando sea posible.
- Usuario Windows restringido, BitLocker/disco cifrado, antivirus y cuentas separadas.
- Copias cifradas diarias a almacenamiento independiente de la PC, con prueba **real** de restauración. Sin backup restaurable, no hay migración.
- La red del hotel es de terceros y puede fallar/aislar dispositivos: proponer router privado de Café Épico con Wi-Fi interno, aún sin módem propio.
- Políticas de acceso a clientes/puntos/ventas, auditoría, permisos de caja, protección de claves y cifrado de cookies.
- No se puede garantizar 100% disponibilidad ni costo energético cero. Con $0 de suscripción usamos equipo propio y herramientas libres, pero debemos garantizar un procedimiento de venta manual de extrema contingencia si falla PC/router.

## Entrega y próximos hitos

- [x] Prueba LAN independiente del POS y autoexpirable.
- [x] Diagnóstico Windows/Docker de solo lectura.
- [x] Pruebas automáticas que garantizan rutas de solo lectura.
- [x] Inicio QA bloqueado si toca nube, organización productiva o ventas LIVE.
- [ ] **Prueba física** con celular de la cafetería, enviada por usuario.
- [ ] Replica oficial de Supabase en Windows instalada, autenticación y datos de QA restaurados.
- [ ] Certificados HTTPS confiables y acceso LAN desde todos los dispositivos.
- [ ] Comandas y cobros con internet WAN desconectado, desde dos móviles.
- [ ] Métricas por SSE/outbox/confirmación de impresión.
- [ ] Acceso remoto mediante una solución Free compatible con uso comercial.
- [ ] Respaldo cifrado de producción restaurado y plan de rollback.
