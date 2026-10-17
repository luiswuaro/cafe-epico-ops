#!/usr/bin/env bash
# Café Épico OPS: respaldo cifrado de datos críticos (lectura únicamente).
# No modifica producción, no escribe datos sin cifrar en disco ni revela URLs.
set -Eeuo pipefail
umask 077

for command in pg_dump age sha256sum date awk stat mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Falta una herramienta: $command" >&2; exit 2
  fi
done
: "${OPS_BACKUP_DATABASE_URL:?Configura OPS_BACKUP_DATABASE_URL por medio seguro}"
: "${OPS_BACKUP_AGE_RECIPIENT:?Configura OPS_BACKUP_AGE_RECIPIENT (clave publica age1...)}"
: "${OPS_BACKUP_DESTINATION:?Configura OPS_BACKUP_DESTINATION (directorio privado)}"

case "$OPS_BACKUP_AGE_RECIPIENT" in
  age1*) ;;
  *) echo "Destinatario age invalido (se espera age1...)" >&2; exit 2 ;;
esac

# PGDATABASE acepta una URI completa de libpq. Evita poner la contraseña
# en los argumentos de pg_dump, salidas de CI o nombres de archivos.
export PGDATABASE="$OPS_BACKUP_DATABASE_URL"
unset OPS_BACKUP_DATABASE_URL
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"
export PGSSLMODE="${PGSSLMODE:-require}"

mkdir -p -- "$OPS_BACKUP_DESTINATION"
chmod 700 -- "$OPS_BACKUP_DESTINATION"
workdir="$(mktemp -d "${OPS_BACKUP_DESTINATION%/}/.ops-backup.XXXXXXXX")"
cleanup(){ rm -rf -- "$workdir"; }
trap cleanup EXIT

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$OPS_BACKUP_DESTINATION/cafe-epico-ops-$stamp.pgcustom.age"
if [[ -e "$archive" ]]; then echo "Archivo ya existente, no se sobrescribe" >&2; exit 1; fi

# Respalda app + cuentas/sesiones de Supabase Auth + metadatos de Storage.
# Sin texto plano persistente: pg_dump -> age mediante pipe.
# IMPORTANTE: esto NO sustituye una copia de claves de Auth, roles globales,
# configuracion de servicios ni los objetos fisicos de Storage.
if ! pg_dump --format=custom --no-owner --no-acl \
     --schema=public --schema=auth --schema=storage \
     | age --recipient "$OPS_BACKUP_AGE_RECIPIENT" \
       > "$workdir/archive.age"; then
  echo "Respaldo abortado; no se publico archivo incompleto" >&2
  exit 1
fi

if [[ ! -s "$workdir/archive.age" ]]; then
  echo "Respaldo vacio" >&2; exit 1
fi
mv -- "$workdir/archive.age" "$archive"
sha256="$(sha256sum "$archive" | awk '{print $1}')"
bytes="$(stat -c %s "$archive")"
manifest="$archive.manifest.txt"
{
  printf 'format=pg_dump_custom_encrypted_age_v1\n'
  printf 'created_utc=%s\n' "$stamp"
  printf 'schemas=public,auth,storage\n'
  printf 'encrypted_file=%s\n' "${archive##*/}"
  printf 'encrypted_bytes=%s\n' "$bytes"
  printf 'sha256=%s\n' "$sha256"
  printf 'verified_restore=no - ejecutar inspect-ops-backup.sh con la clave privada\n'
} > "$manifest"
chmod 600 "$archive" "$manifest"

printf 'Archivo cifrado: %s\nManifest: %s\n' "$archive" "$manifest"
printf 'ATENCION: ejecutar inspeccion y restauracion de ensayo antes de considerarlo recuperable.\n'
