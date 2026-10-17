# ADR-009 — Operación local con una sola fuente transaccional de verdad

**Estado:** Aceptado como arquitectura objetivo para QA; no desplegado en producción.

## Contexto

Café Épico OPS ya opera POS, caja, inventario, puntos, tueste, recetas, compras
y comandas en PostgreSQL/Supabase. El negocio requiere operar sin una conexión
WAN, con terminales de la misma LAN y consultas seguras desde fuera.

## Decisión

- Continuar con **Next.js + Drizzle + PostgreSQL + Auth compatible** para evitar
  reescritura de las reglas del negocio.
- Alojar el servidor y la base primaria **en la PC de la cafetería**.
- Dispositivos LAN acceden al mismo servidor por HTTPS. No hay bases de datos
  maestras separadas por tablet/celular.
- PostgreSQL es la única autoridad para órdenes, pagos, caja, inventario,
  puntos, recetas e impresión; operaciones críticas son transaccionales.
- Acceso remoto externo será un puente autenticado hacia este servidor;
  por diseño no se requiere una copia pública modificable de la base.
- Consultas de lectura remotas no deben exponer datos financieros o personales
  sin autorización y filtro de sucursal.
- En un corte de WAN, la LAN debe continuar si PC, switch/router, TLS, Auth
  local y PostgreSQL siguen disponibles.
- Una futura segunda sucursal **no** se habilita por cambiar
  `DEFAULT_STORE_CODE`: requiere selector de contexto autorizado, separación
  de inventario, transacciones replicadas/idempotentes y política de puntos.

## Escalabilidad por fases

1. **Réplica QA local**: esquemas, Auth, CA/HTTPS, pruebas de ventas y caja.
2. **Impresión robusta**: cola persistente, reclamación y acuse sin papel doble;
   pruebas de desconexión del puente y recuperación.
3. **Notificación LAN**: outbox transaccional durable + SSE o notificaciones;
   LISTEN/NOTIFY solo como señal opcional, nunca como almacenamiento de eventos.
4. **Acceso remoto**: consulta read-only y comandos remotos sometidos a RBAC,
   MFA y pruebas de latencia; ver condiciones comerciales de servicios de túnel.
5. **Multi-sucursal**: diseño de aislamiento, conflicto, sincronización y
   reconciliación contable antes de añadir una sucursal desconectada.

## Operación segura

- No mezclar la DB QA con Supabase comercial ni permitir LIVE en QA.
- No crear un segundo sistema de inventario/puntos en el navegador.
- No depender del estado `navigator.onLine` para intentar conectar con la LAN.
- Mantener el puente ESC/POS y PostgreSQL fuera de la Wi-Fi del hotel.
- Copias cifradas + ensayo de restauración y retención antes de migrar.
- Todo cambio se libera tras validar pruebas SQL, seguridad, permisos y caja.

## Consecuencias

Usar equipo propio elimina cuotas de base de datos/hosting como condición para
cobrar en la LAN, pero no costos eléctricos, mantenimiento ni backups físicos.
La disponibilidad remota depende de Internet y de la PC encendida. No hay alta
disponibilidad sin segundo servidor y estrategia de conmutación.
