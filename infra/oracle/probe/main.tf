terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0.0, < 8.0.0"
    }
  }
}

variable "tenancy_ocid" {
  description = "OCID del tenancy Oracle; se proporciona como secreto, nunca en Git"
  type        = string
  sensitive   = true
}

provider "oci" {
  # El proveedor lee OCI_USER_OCID, OCI_FINGERPRINT, OCI_PRIVATE_KEY_PATH,
  # OCI_TENANCY_OCID y OCI_REGION del runner (secrets de GitHub).
}

# SOLO LECTURA. No hay bloques resource: no se crea ninguna VM, IP,
# volumen, servicio ni producto facturable.
data "oci_identity_availability_domains" "current" {
  compartment_id = var.tenancy_ocid
}

output "availability_domain_count" {
  description = "Cantidad de dominios que OCI expone a este usuario de prueba"
  value       = length(data.oci_identity_availability_domains.current.availability_domains)
}
