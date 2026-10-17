# Piloto Oracle Cloud — verificar administración desde GitHub sin facturación

**Estado inicial: preparado, NO conectado a una cuenta Oracle real.** Café Épico OPS de producción no se modifica.
Esta prueba no es una migración, no resuelve Auth, impresión ni la continuidad offline.

## Qué comprueba

El workflow manual `Oracle Cloud - prueba de conexión SOLO LECTURA` ejecuta un `terraform plan`
con un único data source: `oci_identity_availability_domains`, documentado por Oracle.
No contiene bloques `resource` ni comandos `terraform apply`; por diseño no crea servicios.

Resultados esperados: acceso autorizado, cantidad de dominios y cero modificaciones.

## Requisito inicial del dueño (una vez)

1. Crear/verificar cuenta **Oracle Cloud Free Tier** a su nombre, sin upgrade a pago.
   Elegir región inicial con cuidado: Always Free está condicionado a esa región
   y la capacidad de máquinas gratuitas puede estar agotada.
2. Crear usuario/grupo **específico para esta prueba**, con permisos de consulta
   mínimos sobre los dominios de disponibilidad del tenancy. No usar claves
   de administrador ni permitir crear/borrar recursos.
3. En Oracle, generar una **API signing key** para ese usuario de prueba y registrar
   su clave pública. Guardar la privada únicamente en el gestor seguro de GitHub.
4. En el repositorio de GitHub, en Settings > Secrets and variables > Actions,
   crear **5 Repository secrets**: `OCI_TENANCY_OCID`, `OCI_USER_OCID`,
   `OCI_KEY_FINGERPRINT`, `OCI_REGION`, `OCI_API_PRIVATE_KEY`
   (contenido completo de clave privada PEM; nunca subir archivo PEM a GitHub).
5. Abrir Actions > **Oracle Cloud - prueba de conexión SOLO LECTURA** > Run workflow.

**Nunca pegar claves PEM, contraseñas o secretos en el chat.**
No configuramos automatización con llaves permanentes de administrador.
La cuenta puede exigir tarjeta para verificación, aunque Free Tier no la cobra sin upgrade.

## Qué haría ChatGPT después

- Leer en GitHub el resultado y errores de esta prueba.
- Si funciona: preparar por separado un plan de VM **restringida a Always Free**
  y ejecutar un `terraform plan` antes de solicitar aprobación de cualquier creación.
- Instalar PostgreSQL y Next.js en una VM piloto sin acceso a los clientes de
  producción, primero con datos ficticios.
- En paralelo, habilitar un POS local mínimo para que un corte de internet
  o una suspensión de Oracle no impidan vender.
- Migrar Auth y base productiva **solo tras** respaldos cifrados restaurados,
  pruebas de cobros divididos, impresión, puntos, cierres, seguridad y rollback.

## Límites y costos

El alcance de esta prueba consulta datos IAM y no genera recursos facturables.
No presupone disponibilidad de una VM Always Free. 
Incluso si funciona, Oracle requerirá mantenimiento y el piloto no valida todavía
la capacidad de ChatGPT de controlar Oracle desde un conector directo;
la vía será GitHub Actions/Terraform con acceso delegado y auditado.
