import Link from "next/link";
import { getRoastingDashboard } from "@/src/application/roasting/dashboard";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { RoastIntelligenceLab } from "./roast-lab";
import type { RoastCurvePoint } from "@/src/domain/roasting/curve";

export const dynamic = "force-dynamic";
export default async function AdvancedRoastPage(){
  const {organizationId}=await requirePermission("roast.manage");
  const data=await getRoastingDashboard(organizationId);
  const batches=data.batches.slice(0,35).map(b=>({
    id:b.id, name:b.batchCode, lot:b.lot?.name??"Sin lote",
    greenG:Number(b.greenWeightG),roastedG:Number(b.roastedWeightG),
    greenPriceKg:b.lot?.greenCostPerKg==null?null:Number(b.lot.greenCostPerKg),
    charge:0,yellow:b.yellowingTimeS??null,
    fc:b.firstCrackTimeS??null,drop:b.dropTimeS??null,
    points:Array.isArray(b.curveData)?b.curveData as RoastCurvePoint[]:[],
  }));
  return <main className="shell">
    <section className="hero"><p className="eyebrow">ROAST ENGINEER · PREVIEW EXPERIMENTAL</p>
      <h1>HiBean × Skywalker · diagnóstico avanzado</h1>
      <p className="muted">Doce lentes técnicas, integridad de curva, fases, RoR, merma, consumo y costo parcial por lote. Interpretaciones condicionadas a sensores, eventos y cata.</p>
      <p><Link href="/admin/roasting">Tueste y confirmación de inventario →</Link> · <Link href="/admin/roasting/compare">Comparar históricos →</Link></p>
    </section>
    <RoastIntelligenceLab batches={batches}/>
  </main>;
}
