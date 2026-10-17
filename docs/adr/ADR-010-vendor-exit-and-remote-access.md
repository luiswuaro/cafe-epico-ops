# ADR-010 — Salida gradual de Vercel y acceso remoto sin segundo libro contable

**Decisión objetivo (17 oct 2026).** En QA; no habilitada ni operativa aún.

## Pregunta: ¿mantener Vercel?

El sistema comercial actual **sigue** sirviéndose por Vercel/Supabase hasta
tener un traspaso probado. El objetivo es que **ningún cobro, pedido, impreso,
inventario ni punto dependa de Vercel** cuando la PC sea la autoridad local.

Vercel puede quedarse solo para un sitio informativo estático, pero no está
previsto como proxy de operaciones del POS. El plan gratuito Hobby de Vercel
**prohíbe uso comercial**, incluso con poco tráfico. No diseñar la salida
financiera asumiendo que Vercel Hobby es un backend comercial gratuito:
https://vercel.com/docs/limits/fair-use-guidelines

Tailscale Personal gratuito también se declara solo para uso **no comercial**;
no recomendarlo como túnel gratuito del negocio:
https://tailscale.com/pricing

## Arquitectura elegida

```text
LAN con Wi-Fi privada:          Clientes remotos autorizados:
PC Windows -- Caddy HTTPS <-- Cloudflare Zero Trust Access/Tunnel*
  ├─ Next.js (OPS)                         (una ruta segura hacia misma PC)
  ├─ Auth local
  ├─ PostgreSQL principal
  └─ agente de impresora Windows

* Opción candidata. Aún no implementada ni certificada.
```

- Nunca habilitar dos bases de datos maestras. La nube no escribe copias de
  tickets, pagos, puntos o inventario; toda venta se confirma en PostgreSQL local.
- Con Internet cortado pero LAN viva, POS, impresora y Auth locales deben funcionar.
- Fuera de la cafetería solo funciona si **PC + salida a Internet** están vivos.
- Con PC apagada, tampoco hay acceso remoto; para alta disponibilidad hace falta
  segundo equipo, alimentación y una política de failover (no está presupuestado).
- Las ventas desde celular remoto y las comandas remotas requieren exactamente
  los mismos permisos, idempotencia y controles de empleado que la LAN.

## Opción remota con presupuesto de suscripción $0

Cloudflare Zero Trust publica un plan Free de hasta 50 usuarios y soporta Tunnel,
conectividad saliente sin abrir puertos de la red del hotel y verificación de
identidad. La capacidad comercial es la de *equipos*, no el plan personal de
otro proveedor. Condiciones concretas, creación de cuenta, posible método de
pago, límites, y necesidad de dominio para URL pública deberán verificarse
antes de escoger la modalidad; comprar dominio NO es costo $0.

Fuentes oficiales (revisadas 17/oct/2026):
- https://www.cloudflare.com/sase/products/access/
- https://www.cloudflare.com/plans/
- https://developers.cloudflare.com/cloudflare-one/setup/secure-private-apps/private-web-app/
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/

Alternativa sin dominio público: cliente Cloudflare One en dispositivos
autorizados + ruta de red privada. Exige instalación y gestión de dispositivos.

**No activar Tunnel/Access por ahora**. Primero cerrar el QA LAN, Auth,
impresión, restauración y contabilidad con la antena.

## Condiciones obligatorias antes del remoto

1. Autenticación externa con MFA/Access + empleado OPS RBAC; alta/baja y revocación.
2. Aislar por sucursal. No exponer puertos PostgreSQL, Auth admin, Docker ni
   impresora a Internet. El túnel solo publica la aplicación necesaria.
3. Servir Next/Auth a través de origen HTTPS compatible con el nombre remoto.
   El cliente web actual usa `NEXT_PUBLIC_SUPABASE_URL` en IP privada de LAN:
   **no funcionará directamente desde Internet**. Resolver mismo origen/URL,
   certificados, cookies y redirecciones de Auth sin romper LAN.
4. TLS válido desde Internet, claves separadas de QA, cierre de sesión y
   bloqueo por empleado. Verificar además protección anti-CSRF.
5. Comandas remotas y reimpresión: una sola cola, trabajos con ID idempotente;
   acuse físico probado y no imprimir trabajos atrasados sin política.
6. Pruebas de 2 dispositivos: LAN con WAN caída, remoto con WAN presente,
   fallo de PC, revocación y intentos de cobro simultáneos.
7. Evaluación de privacidad de datos y exposición de metadatos al proveedor.
8. Documentar el costo de electricidad, hardware, respaldo externo y un enlace
   de Internet propio cuando el negocio pueda pagarlo.

## Regla de corte

No desconectar Vercel/Supabase comercial hasta contar con migración de datos
reales revisada, QA físico aprobado, rollback y registro de las ventas durante
la transición. No fusionar esta rama mientras esté en estado draft.
