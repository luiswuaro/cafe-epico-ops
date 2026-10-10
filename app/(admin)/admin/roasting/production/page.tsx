import Link from "next/link";
import { getRoastingDashboard } from "@/src/application/roasting/dashboard";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { startHiBeanRoastImport } from "../import-actions";
import { RoastSessionPlanner } from "./session-planner";

export const dynamic="force-dynamic";

function localDate(date:Date){
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(date);
}

export default async function RoastProductionPage(){
  const {organizationId}=await requirePermission("roast.manage");
  const data=await getRoastingDashboard(organizationId);
  const lots=data.lots.filter(lot=>lot.isActive).map(lot=>({
    id:lot.id,name:lot.name,
    greenStockG:lot.greenStockG,
    greenStockSource:lot.greenStockSource,
    averageLossPct:lot.averageLossPct,
    greenCostPerKg:lot.greenCostPerKg==null?null:Number(lot.greenCostPerKg),
    targetUse:lot.targetUse,
  }));
  const batches=data.batches.slice(0,150).map(batch=>({
    id:batch.id,lotId:batch.coffeeLotId,
    code:batch.batchCode,
    date:localDate(batch.roastedAt),
    greenG:Number(batch.greenWeightG),
    roastedG:Number(batch.roastedWeightG),
    dtrPct:batch.dtrPct==null?null:Number(batch.dtrPct),
    lossPct:Number(batch.weightLossPct),
    provider:batch.sourceProvider,
    inventoryPosted:batch.inventoryPosted,
  }));

  return <main className="shell">
    <section className="hero">
      <p className="eyebrow">INGENIERÍA DEL CAFÉ · PRODUCCIÓN</p>
      <h1>Sesión de tueste · HiBean</h1>
      <p className="muted">Planifica los 5 kg de verde, registra el peso al salir
        de cada batch y confirma los JSON de HiBean uno por uno en OPS.
        Un plan no mueve inventario; la importación exige confirmación.</p>
      <Link href="/admin/roasting" className="button">← Volver a Ingeniería de tueste</Link>
    </section>
    <RoastSessionPlanner lots={lots} batches={batches}/>
    <section className="card stack" style={{marginTop:"1rem"}}>
      <p className="eyebrow">05 · IMPORTAR SIGUIENTE BATCH</p>
      <h2>Subir JSON de HiBean</h2>
      <p>Este es el importador existente de OPS. Detecta el café y la curva,
        comprueba si el archivo ya fue importado y te lleva a la pantalla
        donde confirmas inventario y pesos. Puedes utilizarlo repetidamente
        conforme terminas cada carga.</p>
      <form action={startHiBeanRoastImport} encType="multipart/form-data" className="stack">
        <label>Archivo JSON exportado desde HiBean
          <input name="roastFile" type="file" accept=".json,application/json" required/>
        </label>
        <button type="submit">Leer JSON y revisar antes de registrar</button>
      </form>
      <p className="muted">Límite de 8 MB por archivo. Un archivo confirmado
        no vuelve a crear el mismo batch al importarlo de nuevo.</p>
    </section>
  </main>;
}
