import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  roastContractClients, roastContractLots, roastContractBatches,
  roastContractDeliveries,
} from "@/src/infrastructure/db/schema";

import { inspectDefects,mass,round2 } from "./contract-utils";
export { defectTypes, inspectDefects,mass,round2 } from "./contract-utils";

export async function getContractDashboard(organizationId:string) {
  const db=getDb();
  const [clients,lots,batches,deliveries]=await Promise.all([
    db.select().from(roastContractClients).where(eq(roastContractClients.organizationId,organizationId))
      .orderBy(roastContractClients.name),
    db.select().from(roastContractLots).where(eq(roastContractLots.organizationId,organizationId))
      .orderBy(sql`${roastContractLots.createdAt} desc`),
    db.select().from(roastContractBatches).where(eq(roastContractBatches.organizationId,organizationId))
      .orderBy(sql`${roastContractBatches.roastedAt} asc`),
    db.select().from(roastContractDeliveries).where(eq(roastContractDeliveries.organizationId,organizationId))
      .orderBy(sql`${roastContractDeliveries.deliveredAt} desc`),
  ]);
  const batchByLot=new Map<string,typeof batches>();
  const deliveredByBatch=new Map<string,number>();
  for(const delivery of deliveries)deliveredByBatch.set(delivery.batchId,
    round2((deliveredByBatch.get(delivery.batchId)??0)+mass(delivery.grams)));
  for(const batch of batches){
    const list=batchByLot.get(batch.lotId)??[];
    list.push(batch);batchByLot.set(batch.lotId,list);
  }
  const groups=lots.map(lot=>{
    const lotBatches=batchByLot.get(lot.id)??[];
    const usedGreenG=round2(lotBatches.reduce((sum,b)=>sum+mass(b.greenG),0));
    const roastedG=round2(lotBatches.reduce((sum,b)=>sum+mass(b.roastedG),0));
    const deliveredG=round2(lotBatches.reduce((sum,b)=>sum+(deliveredByBatch.get(b.id)??0),0));
    const sampleG=round2(lotBatches.reduce((sum,b)=>sum+mass(b.greenDefectSampleG),0));
    const defectG=round2(lotBatches.reduce((sum,b)=>sum+
      inspectDefects(mass(b.greenDefectSampleG)||null,b.defects).totalG,0));
    return {
      ...lot,
      client:clients.find(c=>c.id===lot.clientId)??null,
      batches:lotBatches.map(b=>({
        ...b,deliveredG:deliveredByBatch.get(b.id)??0,
        quality:inspectDefects(mass(b.greenDefectSampleG)||null,b.defects),
      })),
      deliveredG,usedGreenG,roastedG,
      remainingGreenG:round2(mass(lot.greenReceivedG)-usedGreenG),
      readyRoastedG:round2(roastedG-deliveredG),
      feeAccrued:round2(usedGreenG/1000*mass(lot.feePerKgGreen)),
      lossPct:usedGreenG>0?round2((usedGreenG-roastedG)/usedGreenG*100):null,
      assessedBatches:lotBatches.filter(b=>mass(b.greenDefectSampleG)>0).length,
      sampleG,defectG,
      defectPct:sampleG>0?round2(defectG/sampleG*100):null,
    };
  });
  return {clients,groups};
}

export async function getContractReportData(
  organizationId:string,lotId:string,selectedBatchIds:string[],
){
  const db=getDb();
  const [lot]=await db.select().from(roastContractLots)
    .where(and(eq(roastContractLots.organizationId,organizationId),eq(roastContractLots.id,lotId)))
    .limit(1);
  if(!lot)return null;
  const [client]=await db.select().from(roastContractClients)
    .where(and(eq(roastContractClients.id,lot.clientId),eq(roastContractClients.organizationId,organizationId)))
    .limit(1);
  if(!client)return null;
  const eligible=selectedBatchIds.length?selectedBatchIds:[];
  if(eligible.length<1||eligible.length>60)return null;
  const batches=await db.select().from(roastContractBatches).where(and(
    eq(roastContractBatches.organizationId,organizationId),
    eq(roastContractBatches.lotId,lotId),
    inArray(roastContractBatches.id,eligible),
  )).orderBy(roastContractBatches.roastedAt);
  if(batches.length!==new Set(eligible).size)return null;
  const deliveries=await db.select().from(roastContractDeliveries)
    .where(and(eq(roastContractDeliveries.organizationId,organizationId),
      inArray(roastContractDeliveries.batchId,batches.map(b=>b.id))));
  return {lot,client,batches,deliveries};
}
