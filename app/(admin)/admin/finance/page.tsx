import Link from "next/link";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getFinancialPreview } from "@/src/application/finance/preview";
import { FinancialWorkbench } from "./financial-workbench";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const { organizationId } = await requirePermission("admin.access");
  const data = await getFinancialPreview(organizationId);
  return <main className="shell">
    <section className="hero"><p className="eyebrow">DIRECCIÓN · FINANZAS · PREVIEW</p>
      <h1>Centro financiero de Café Épico</h1>
      <p className="muted">Ingresos de tickets cobrados en OPS LIVE, costos por receta y por servicio, gastos corrientes mensuales editables, punto de equilibrio y simulador de promociones. Los gastos del simulador se conservan sólo en este navegador; falta conciliación contable para reportar utilidad libre real.</p>
      <p><Link href="/admin/analytics">Analítica histórica →</Link> · <Link href="/admin">Administración →</Link></p>
    </section>
    <FinancialWorkbench data={data}/>
  </main>;
}
