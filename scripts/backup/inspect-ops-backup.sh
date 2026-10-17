#!/usr/bin/env bash
# Inspecciona el archivo cifrado sin restaurarlo ni modificar bases de datos.
set -Eeuo pipefail
umask 077
if [[ $# -ne 1 ]]; then
  echo "Uso: OPS_BACKUP_AGE_IDENTITY=/ruta/clave.txt $0 archivo.pgcustom.age" >&2
  exit 2
fi
archive="$1"
: "${OPS_BACKUP_AGE_IDENTITY:?Proporciona una clave privada age como ruta local}"
for command in age pg_restore sha256sum awk grep mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Falta una herramienta: $command" >&2; exit 2
  fi
done
[[ -r "$archive" && -r "$OPS_BACKUP_AGE_IDENTITY" ]] || {
  echo "No puedo leer el archivo cifrado o la identidad age" >&2; exit 2;
}
manifest="$archive.manifest.txt"
if [[ -f "$manifest" ]]; then
  expected="$(awk -F= '$1=="sha256"{print $2}' "$manifest")"
  actual="$(sha256sum "$archive" | awk '{print $1}')"
  [[ -n "$expected" && "$expected" == "$actual" ]] || {
    echo "Error de integridad SHA256 del archivo cifrado" >&2; exit 1;
  }
fi
workdir="$(mktemp -d)"
trap 'rm -rf -- "$workdir"' EXIT
# age verifica autenticidad/integridad criptografica del stream al descifrar.
# El TOC generado tiene nombres de objetos, NO filas ni contraseñas.
if ! age --decrypt --identity "$OPS_BACKUP_AGE_IDENTITY" "$archive" | \
     pg_restore --list > "$workdir/toc.txt"; then
  echo "Fallo al descifrar o inspeccionar pg_dump" >&2; exit 1
fi

required=(
 "TABLE DATA public pos_orders "
 "TABLE DATA public pos_payments "
 "TABLE DATA public inventory_movements "
 "TABLE DATA public pos_loyalty_entries "
 "TABLE DATA public pos_customers "
 "TABLE DATA auth users "
 "TABLE DATA auth sessions "
 "TABLE DATA storage objects "
)
for object in "${required[@]}"; do
  if ! grep -Fq "$object" "$workdir/toc.txt"; then
    echo "Respaldo incompleto: falta $object" >&2; exit 1
  fi
done
printf 'Integridad y estructura: PASS\n'
printf 'Entradas TABLE DATA: '
grep -c 'TABLE DATA ' "$workdir/toc.txt"
printf 'PRECAUCION: falta una restauracion aislada y pruebas de datos/usuarios para certificar recuperacion.\n'
