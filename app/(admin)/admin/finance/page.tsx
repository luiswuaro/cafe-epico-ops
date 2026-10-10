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
      <p className="muted">Ingresos de tickets pagados OPS LIVE, costos por receta, editor de gastos fijos/variables/puntuales e impuestos estimados: IVA incluido 16% sin acreditamiento, ISR RESICO 2% sobre ingresos sin IVA. Los gastos del preview se conservan sólo en este navegador; falta conciliación y ventas de otros giros para utilidad libre real.</p>
      <p><Link href="/admin/analytics">Analítica histórica →</Link> · <Link href="/admin">Administración →</Link></p>
    </section>
    <FinancialWorkbench data={data}/>
  </main>;
}
