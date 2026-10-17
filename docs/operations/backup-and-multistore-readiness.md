# Café Épico OPS — recuperación y crecimiento multisucursal

**Estado:** preparación técnica, solo lectura. Todavía NO hay un respaldo restaurado y certificado.
**Producción:** Supabase + Vercel siguen siendo la fuente de verdad; no cambiar DNS, DATABASE_URL ni Auth sin ventana de migración.

## Inventario verificado el 16/oct/2026 (producción)

- 82 tablas `public`, ~35 MB de PostgreSQL según `pg_database_size` (~52 MB en el panel de cuota).
- 213 FK en `public`; 1 FK desde `public` hacia `auth`.
- 2 registros en `auth.users`, 4 `employees`, 189 ventas cuando se auditó la base.
- 0 objetos en `storage.objects` durante la auditoría. Revalidar inmediatamente antes del corte.
- Extensiones existentes: `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `supabase_vault`, `uuid-ossp`.
- Ya existen `organizations`, `stores`, `store_id` en ventas, caja, movimientos, saldos, auditoría y estaciones de impresión. Hay una sucursal productiva (`TEPEXI`) y una organización QA (`QA-TEPEXI`); no se han validado dos sucursales comerciales simultáneas.
- `pos_customers` y `pos_loyalty_entries` tienen alcance de organización: puntos compartidos entre sucursales **por diseño**, sujeto a aprobación operativa.
- Precios/productos, partes de impresora y empleados requieren pruebas de aislamiento multi-sucursal.
- Hoy `DEFAULT_STORE_CODE` elige la sucursal del servidor; **no habilitar segundo local sin selector de sucursal autorizado en la sesión**.

## Fase 1: preservar datos antes de migrar

Se añadieron:

- `scripts/backup/backup-ops.sh`: exporta `public`, `auth` y `storage` en formato custom de PostgreSQL 17; cifra *en stream* a destinatario `age` antes de escribir en disco; firma SHA-256 del archivo cifrado. Solo lectura.
- `scripts/backup/inspect-ops-backup.sh`: valida SHA-256, descifra íntegramente a directorio temporal **solo en equipo seguro**, lee/descomprime la totalidad del dump y comprueba que existan objetos críticos. No se conecta a ninguna base ni ejecuta comandos SQL.
- **Aún no existe una copia de recuperación validada** hasta que se ejecute un dump real, una inspección exitosa y un ensayo de restauración en destino aislado.

### Requisitos de ejecución

En una computadora o runner privado controlado: PostgreSQL 17 `pg_dump`/`pg_restore`, `age`/`age-keygen`, y permiso de lectura de esquemas `public`, `auth`, `storage`.

1. Generar **una vez** clave `age-keygen -o /ruta-segura/ops-recovery-key.txt`. Guardar **clave privada fuera del repositorio, de Vercel y de Google Drive que contenga el respaldo**, idealmente en dos ubicaciones físicas seguras. Conservar pública `age1...`.
2. Proveer URL de **Session Pooler** con acceso para `pg_dump` mediante un gestor de secretos; nunca pegarla en commits, mensajes ni en la consola compartida.
3. Ejecutar en entorno seguro:

```bash
read -rsp 'URI privada del Session Pooler (oculta): ' OPS_BACKUP_DATABASE_URL
printf '\\n'
export OPS_BACKUP_DATABASE_URL
export OPS_BACKUP_AGE_RECIPIENT='age1...'
export OPS_BACKUP_DESTINATION='/ruta-privada/ops-backups'
bash scripts/backup/backup-ops.sh

export OPS_BACKUP_AGE_IDENTITY='/ruta-segura/ops-recovery-key.txt'
bash scripts/backup/inspect-ops-backup.sh '/ruta-privada/ops-backups/<archivo>.pgcustom.age'
```

**Precaución:** el comando de ejemplo muestra marcadores; nunca guardar valores reales en scripts ni historial de terminal. El inspector crea temporalmente un dump descifrado: usar disco cifrado y una PC protegida; eliminarlo físicamente de un SSD no se puede garantizar solo borrando archivos.

4. Subir **únicamente** `.age` y `manifest.txt` a Drive y a un segundo medio externo, tras inspección. Nunca subir `.custom` sin cifrar ni `ops-recovery-key.txt` junto con el respaldo.
5. Restaurar en instancia PostgreSQL/Supabase **aislada**: roles/servicios adecuados primero, luego `pg_restore` con inspección de objetos problemáticos (Supabase Auth/Storage pueden requerir servidor compatible). Comparar cantidades, FK, puntos y cobros y comprobar login e impresión. No ejecutar restauración contra producción.

### Qué NO cubre por sí solo el dump

- Variables secretas de Vercel, certificados TLS, contraseñas de conexión, JWT signing keys de Supabase, claves de servicio ni configuración de Auth.
- Roles globales o permisos de plataforma que necesiten recrearse en otro servidor.
- Archivos físicos de Storage (0 objetos en el momento de esta auditoría, no confiar para futuras copias).
- Estado de la PC puente/impresora y sus configuraciones locales, sesiones del navegador.
- PostgreSQL WAL/PITR o escrituras posteriores al instante del dump.
- `pg_cron`, `pg_net`, `supabase_vault` podrían no estar disponibles en PostgreSQL de otros proveedores.

**RPO objetivo**: hasta un día si respaldamos al cierre; reducir al implementar automatización segura. **RTO objetivo**: probar recuperación en <4 horas, NO garantizado sin simulacro. Mantener 3 copias, en 2 medios, una fuera del negocio.

## Decisión de base de datos

**PostgreSQL, independientemente del hosting.** No convertir a hojas de cálculo, Google Drive como DB ni SQLite/D1 sin un proyecto adicional de migración y seguridad.

- **Aiven Free:** PostgreSQL administrado, datos pequeños caben en 1 GB; 20 conexiones, sin pooling ni SLA. Vercel serverless puede agotarlas. Piloto solamente con medidor de conexiones y Auth resuelto.
- **Oracle Always Free:** VM PostgreSQL + Auth + app en una misma infraestructura podría evitar los límites actuales de Supabase y Hobby comercial de Vercel. Exige mantenimiento, monitoreo, firewall, backups y prueba de disponibilidad; `$0` no garantiza indefinidamente recursos.
- **Servidor local i7/16 GB**: contingencia y eventualmente sucursal autónoma con impresión offline en LAN; acceso remoto requiere red, seguridad y disponibilidad.
- No cambiar `DATABASE_URL` mientras Auth siga dependiendo de Supabase y no se haya migrado la FK a `auth.users`.

## Multisucursal: arquitectura objetivo

```
Organización Café Épico
  Catálogo / recetas versionadas / proveedores / clientes / lealtad
        |
  PostgreSQL central con transacciones e historial inmutable
        |
    +---+--------------------+--------------------+
    |                        |                    |
  Sucursal Tepexi          Sucursal 2          Tostaduría / central
  Caja + inventario        Caja + inventario   Lotes + transferencias
  PC puente local          PC puente local     Producción y reparto
```

Los usuarios autenticados acceden **solo** a tiendas asignadas. Administradores pueden elegir varias. Cada transacción conserva `organization_id`, `store_id`, zona horaria de negocio, empleado y referencia idempotente.

### Bloqueantes antes de sucursal 2

1. **Selección segura de tienda:** resolver por sesión/roles; no por dato editable del navegador. Eliminar supuesto global `DEFAULT_STORE_CODE` en flujos de venta; garantizar permisos de alcance de tienda en cada acción.
2. **Precios por tienda:** catálogo y recetas globales versionados; precios, promociones, variantes y empaques específicos por sucursal; snapshot inmutable del precio aplicado en cada ticket.
3. **Inventario físico y traslados:** stock por tienda y ubicación; salida de almacén central + recepción en destino como una operación idempotente, con trazabilidad y costo de transferencia; no copiar balances entre sucursales.
4. **Caja y pagos:** sesión de caja, ventas, cobros y cancelaciones por sucursal, conciliación global y por local; reportes por fecha local y fecha de pago sin mezclarlos.
5. **Lealtad:** saldo global por organización si lo aprueba el dueño; ledger transaccional único para impedir dobles canjes entre sucursales.
6. **Impresión:** estación independiente por `store_id`; filtro de tareas por tienda; seguimiento de heartbeat y deduplicación de tickets por estación.
7. **Continuidad offline:** cada local debe poder vender en su LAN durante caída de internet con cola local cifrada, UUID e idempotencia al sincronizar. No hay que afirmar que OPS actual ya opera offline.
8. **Métrica de costos:** COGS histórico por receta, presentación, merma y costo de reposición por tienda; EBITDA/beneficio de contribución consolidado sin ocultar fijos de cada local.

### Pruebas mínimas antes de abrir

- Un empleado de Tepexi no puede consultar, imprimir, cancelar ni cobrar en la sucursal 2.
- Dos ventas simultáneas en sucursales distintas no chocan en folios, pagos ni inventario.
- Transferencia de 1 kg de café de central a sucursal sin crear inventario de la nada.
- Canje simultáneo de puntos en dos cajas no admite doble gasto.
- Reimpresión no se envía a la impresora de la tienda equivocada.
- Cierre de caja y reportes por local y consolidados concilian con medios de pago.
- Desconexión prolongada, reconexión, restauración de respaldo y reversión de migración se prueban con datos ficticios.

## ¿Volver a Loyverse?

No como sistema de verdad para Café Épico. Su POS y multitienda básico son gratuitos, pero funciones de personal/inventario avanzado e historia ampliada pueden ser de pago. No sustituye tueste, escandallos, auditorías de costos y automatización del OPS.

Como **contingencia temporal** podría servir si se documenta una única fuente de cobro y cómo reconciliar manualmente las ventas; nunca operar dos POS simultáneos sin control de idempotencia.

## Criterios de salida de Fase 1

- [x] Auditoría estructural y arquitectura objetivo documentadas.
- [x] Scripts de backup cifrado y revisión estructural en GitHub.
- [ ] Backup real ejecutado con credencial autorizada; archive `.age` verificado.
- [ ] Copia cifrada fuera de la nube actual.
- [ ] Restauración aislada de producción con conteos y pruebas (sin afectar POS).
- [ ] Proveedor destino seleccionado con prueba de carga + Auth compatible.
