import Link from "next/link";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getFinancialPreview } from "@/src/application/finance/preview";
import { getSavedFinancialBudget } from "@/src/application/finance/budget-store";
import { FinancialWorkbench } from "./financial-workbench";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const { organizationId } = await requirePermission("admin.access");
  const [data,sharedBudget] = await Promise.all([
    getFinancialPreview(organizationId),getSavedFinancialBudget(organizationId),
  ]);
  return <main className="shell">
    <section className="hero"><p className="eyebrow">DIRECCIÓN · FINANZAS · PRESUPUESTO COMPARTIDO · PREVIEW</p>
      <h1>Centro financiero de Café Épico</h1>
      <p className="muted">Ingresos de tickets pagados OPS LIVE, costos por receta, editor de gastos fijos/variables/puntuales e impuestos estimados: IVA incluido 16% sin acreditamiento, ISR RESICO 2% sobre ingresos sin IVA. Puedes guardar y consultar el mismo presupuesto desde tus dispositivos autorizados. Siguen siendo escenarios y registros manuales, no egresos conciliados; faltan ventas de otros giros para utilidad libre real.</p>
      <p><Link href="/admin/analytics">Analítica histórica →</Link> · <Link href="/admin">Administración →</Link></p>
    </section>
    <FinancialWorkbench data={data} sharedBudget={sharedBudget}/>
  </main>;
}
