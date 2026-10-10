import Link from "next/link";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {getPosCatalog} from "@/src/application/pos/catalog";
import {getPosCustomers} from "@/src/application/pos/customers";
import {BenefitsPreview} from "./benefits-simulator";

export const dynamic="force-dynamic";

/** Read-only PREVIEW. No mutation or checkout action in this route. */
export default async function BenefitsPreviewPage(){
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const [catalog,customers]=await Promise.all([
    getPosCatalog(employee.organizationId),
    getPosCustomers(employee.organizationId),
  ]);
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div>
        <p className="eyebrow">PAQUETE DE PREVIEW · OPERACIÓN POS</p>
        <h1>Simulador de descuentos y puntos</h1>
        <p className="muted">Utiliza el catálogo y saldos de clientes actuales; no registra operaciones. Aquí probaremos los cálculos antes de habilitar canjes o cortesías LIVE.</p>
      </div>
      <Link href="/pos" className="button">← Volver al POS</Link>
    </section>
    <p className="status-warn">Sin cargos, sin puntos descontados, sin movimientos de inventario, sin pagos y sin impresiones. Las reglas de conversión y acumulación de beneficios requieren tu confirmación.</p>
    <BenefitsPreview
      catalog={catalog.filter(x=>x.active).map(x=>({
        id:x.id,name:x.name,category:x.category,price:x.price,
      }))}
      customers={customers.filter(x=>x.isActive).map(x=>({
        id:x.id,name:x.name,pointsBalance:Number(x.pointsBalance),
      }))}
    />
  </main>;
}
