# Respaldo y recuperación local de Café Épico OPS

**Estado:** respaldo, inspección y restauración lógica aprobados en CI con PostgreSQL 17, `age` y datos QA sintéticos. Todavía **no** probados en la PC de barra.
**No utilizar como único respaldo antes de completar un ensayo de restauración física desde otro disco y una instalación distinta.**

## Propósito y alcance

Respalda tablas de `public`, `auth` y `storage` con `pg_dump` formato
custom; cifra directamente el flujo con `age`. Se conservan en el archivo los datos de tickets, clientes, puntos,
inventario y lotes de tueste. Desde la revisión QA del 17/10/2026,
los NUEVOS respaldos incluyen también las ACL SQL (sin `--no-acl`).
Los respaldos creados antes de esa revisión OMITEN ACL y no sirven
por sí solos para recuperar los permisos PostgreSQL.
La inclusión y restauración efectiva de los permisos requiere
inspeccionar el TOC y comparar privilegios contra el origen. Los tres esquemas
**no incluyen los archivos físicos de Storage**: si se comienzan a guardar
fotos o PDFs allí, hace falta copiar aparte su volumen/bucket y probarlo.
Tampoco incluye los certificados Caddy, claves JWT, contraseñas y variables
de la pila Docker; se deben respaldar **por separado** en medios seguros.

No hay archivo `.dump` sin cifrar en disco: pg_dump → age → `.partial`
cifrado → archivo definitivo + manifest SHA-256.


## Qué se validó en CI (17 de octubre de 2026)

El trabajo `local-qa-postgres` ejecutó:

1. PostgreSQL 17 temporal con 34 migraciones y datos de prueba.
2. Cliente, pedido de $70, línea, pago, 22.50 puntos, movimiento de 3.50,
   caja, inventario histórico, usuario Auth ficticio y permisos.
3. `pg_dump` custom → `age` en flujo → archivo cifrado con manifiesto SHA-256.
4. Inspector que valida SHA y analiza `pg_restore --list` sin volcar
   texto plano al disco. El flujo descifrado se consume completo.
5. Restauración directa en la base independiente `ci_restore` dentro del
   **mismo contenedor efímero** de GitHub Actions.
6. Igualdad exacta de conteos, importes, saldos, puntos, inventario,
   usuarios y migraciones, y ausencia de referencias huérfanas.

**Resultado: PASS.** Es una prueba automatizada de restauración *lógica* y
no comprueba sectores de disco, copia USB, falla eléctrica, contraseña de un
Auth real, certificados ni archivos físicos de Storage. Esos casos siguen
como barreras obligatorias antes de cambiar el POS comercial.

## Requisitos en Windows

- PostgreSQL Client **17** en PATH (`pg_dump --version`, `pg_restore --version`).
- `age` en PATH (binario oficial `age --version`).
- Node 22+.
- PostgreSQL local funcionando y accesible por `127.0.0.1`.
- Un dispositivo de almacenamiento separado de la PC (USB/SSD externo), con
  espacio suficiente y protegido contra accesos no autorizados.
- Una identidad age generada una vez con `age-keygen`; guardar la **privada**
  fuera de la PC del POS, con una copia de recuperación protegida.
- Solamente la clave **pública** `age1...` se configura para respaldar.

La tarea comprueba `OPS_LOCAL_FIRST=true`, la URL PostgreSQL loopback,
la clave pública age y que la carpeta destino esté fuera del repositorio.
No acepta Supabase.com, Vercel ni una conexión PostgreSQL LAN.

## Ejecutar copia cifrada

En `.env.local` de la PC **local**, configurar adicionalmente:

```dotenv
OPS_BACKUP_AGE_RECIPIENT=age1_CLAVE_PUBLICA_REAL
OPS_BACKUP_DESTINATION=E:/CafeEpico/Backups
```

La URL `DATABASE_URL` sigue protegida por el archivo local fuera de Git.
Si la unidad `E:` no existe, ajustar a la ruta del medio externo real.

```powershell
node --env-file=.env.local scripts/local/backup-ops-local.mjs
```

Si el respaldo es correcto, muestra la ruta de un
`cafe-epico-local-*.pgcustom.age` y su `.manifest.txt`. El manifiesto
registra fecha, tamaño, hash SHA-256 y deja `restore_tested=no`.
**No tratar la existencia del archivo como prueba de recuperación.**
Verificar ACL en respaldos nuevos con
`node scripts/local/inspect-ops-local-backup.mjs --show-acls --require-acls`
y restaurar en una nueva base QA vacía. El respaldo antiguo, aunque
recuperable en datos, no es una copia íntegra de permisos.

## Inspección criptográfica y estructura

Con la llave privada `age` conectada temporalmente al equipo seguro:

```powershell
$env:OPS_BACKUP_ARCHIVE="E:\CafeEpico\Backups\ARCHIVO.pgcustom.age"
$env:OPS_BACKUP_AGE_IDENTITY="F:\ClaveResguardo\age-identity.txt"
node scripts/local/inspect-ops-local-backup.mjs
Remove-Item Env:OPS_BACKUP_AGE_IDENTITY
```

Valida SHA-256, descifra únicamente en flujo y comprueba que pg_restore puede
leer el índice del archivo, con las tablas de POS, clientes, inventario
histórico y usuarios Auth. **No escribe texto plano.**

Después es obligatorio restaurar en una **segunda instancia desconectada
de producción**, comparar conteos, saldos, puntos, FKs y probar el inicio de
sesión. Evitar restauraciones directas en la PC que cobra.

## Política de operaciones (propuesta para pruebas)

- Un respaldo al cierre de cada día, con segundo medio o copia offsite
  cifrada independiente; la automatización Windows se configura solamente
  cuando el procedimiento manual ya haya pasado varias veces.
- Revisión periódica de espacio libre, integridad SHA y clave recuperable.
- Ensayo de restauración independiente al menos una vez antes de migrar,
  y después de cambios sustantivos de versión.
- Para un punto de recuperación menor a un día, evaluar WAL y estrategia
  de backup continuo: este script por sí solo es un snapshot puntual.
- Nunca colocar el archivo privado age junto al respaldo cifrado.
- Proteger los accesos al disco de Windows y al dispositivo externo.
