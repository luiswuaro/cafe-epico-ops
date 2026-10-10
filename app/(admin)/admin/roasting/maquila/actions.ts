"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { roastContractClients,roastContractLots,roastContractBatches,
  roastContractDeliveries,type RoastContractDefect } from "@/src/infrastructure/db/schema";
import { defectTypes,round2 } from "@/src/application/roasting/contracts";

const ROUTE="/admin/roasting/maquila";
const val=(f:FormData,key:string)=>String(f.get(key)??"").trim();
function num(f:FormData,key:string){
  const text=val(f,key);
  return text!==""&&Number.isFinite(Number(text))?Number(text):Number.NaN;
}
function optionalNum(f:FormData,key:string){
  const text=val(f,key);
  return text===""?null:Number(text);
}
function validText(text:string,max=250){return text.length>0&&text.length<=max}
function finite(n:number|null,min:number,max:number) {
  return n===null||(Number.isFinite(n)&&n>=min&&n<=max);
}
function fail(code:string,lotId?:string):never{
  redirect(ROUTE+"?error="+encodeURIComponent(code)+(lotId?"&lot="+encodeURIComponent(lotId):""));
}
const refresh=()=>revalidatePath(ROUTE);

export async function createContractClient(data:FormData){
  const {organizationId}=await requirePermission("roast.manage");
  const name=val(data,"name"),contact=val(data,"contact"),phone=val(data,"phone"),email=val(data,"email");
  if(!validText(name,120)||name.length<2||contact.length>140||phone.length>50||email.length>160)
    fail("cliente-invalido");
  const db=getDb();
  await db.insert(roastContractClients).values({organizationId,name,
    contact:contact||null,phone:phone||null,email:email||null,notes:val(data,"notes").slice(0,1200)||null});
  refresh();
  redirect(ROUTE+"?ok=cliente");
}

export async function createContractLot(data:FormData){
  const {organizationId}=await requirePermission("roast.manage");
  const clientId=val(data,"clientId"),coffeeName=val(data,"coffeeName");
  const green=num(data,"greenReceivedG"),rate=num(data,"feePerKgGreen");
  if(!validText(coffeeName,140)||coffeeName.length<2||!finite(green,.01,1_000_000)||
      !finite(rate,0,100000))fail("lote-invalido");
  const db=getDb();
  const [client]=await db.select({id:roastContractClients.id}).from(roastContractClients)
    .where(and(eq(roastContractClients.id,clientId),eq(roastContractClients.organizationId,organizationId)))
    .limit(1);
  if(!client)fail("cliente-inexistente");
  const [lot]=await db.insert(roastContractLots).values({
    organizationId,clientId,coffeeName,
    origin:val(data,"origin").slice(0,180)||null,
    producer:val(data,"producer").slice(0,160)||null,
    variety:val(data,"variety").slice(0,160)||null,
    process:val(data,"process").slice(0,120)||null,
    greenReceivedG:String(round2(green)),feePerKgGreen:String(round2(rate)),
    notes:val(data,"notes").slice(0,1200)||null,
  }).returning({id:roastContractLots.id});
  refresh();
  redirect(ROUTE+"?ok=lote&lot="+lot.id);
}

function parseDefects(data:FormData,sampleG:number|null):RoastContractDefect[] | null {
  const raw=val(data,"defectsJson");
  if(raw.length>12000)return null;
  let items:unknown;
  try{items=JSON.parse(raw||"[]");}catch{return null;}
  if(!Array.isArray(items)||items.length>24)return null;
  const defects:RoastContractDefect[]=[];
  for(const item of items){
    if(!item||typeof item!=="object")return null;
    const record=item as Record<string,unknown>;
    const type=String(record.type??"").trim();
    const severity=String(record.severity??"");
    const count=Number(record.count);
    const grams=Number(record.grams);
    if(!defectTypes.includes(type as (typeof defectTypes)[number])||
      !["PRIMARY","SECONDARY","OTHER"].includes(severity)||
      !Number.isInteger(count)||count<1||count>10000||
      !Number.isFinite(grams)||grams<0||grams>10000)return null;
    defects.push({type,severity:severity as RoastContractDefect["severity"],
      count,grams:round2(grams)});
  }
  const measured=round2(defects.reduce((sum,x)=>sum+x.grams,0));
  if((sampleG===null&&defects.length>0)||(sampleG!==null&&measured>sampleG+0.005))
    return null;
  return defects;
}

export async function createContractBatch(data:FormData){
  const {organizationId}=await requirePermission("roast.manage");
  const lotId=val(data,"lotId"),code=val(data,"batchCode");
  const green=num(data,"greenG"),roasted=num(data,"roastedG");
  const sample=optionalNum(data,"greenDefectSampleG");
  const fc=optionalNum(data,"firstCrackC"),drop=optionalNum(data,"dropC");
  const dtr=optionalNum(data,"dtrPct"),duration=optionalNum(data,"durationS");
  const defects=parseDefects(data,sample);
  const dateText=val(data,"roastedAt");
  const roastedAt=dateText?new Date(dateText):new Date();
  if(!validText(code,100)||!finite(green,.01,100000)||!finite(roasted,.01,100000)||
    roasted>green||!finite(sample,.01,10000)||!finite(fc,0,350)||
    !finite(drop,0,350)||!finite(dtr,0,100)||!finite(duration,1,100000)||
    (duration!==null&&!Number.isInteger(duration))||
    !Number.isFinite(roastedAt.getTime())||defects===null)fail("batch-invalido",lotId);

  const db=getDb();
  let problem="";
  await db.transaction(async tx=>{
    // Lock individual job, so simultaneous operators cannot consume the same green twice.
    const [lot]=await tx.select().from(roastContractLots)
      .where(and(eq(roastContractLots.organizationId,organizationId),
        eq(roastContractLots.id,lotId))).for("update").limit(1);
    if(!lot||lot.status!=="OPEN"){problem="lote-cerrado";return;}
    const [used]=await tx.select({
      total:sql<string>`coalesce(sum(${roastContractBatches.greenG}),0)`,
    }).from(roastContractBatches).where(eq(roastContractBatches.lotId,lotId));
    if(round2(Number(used.total)+green)>Number(lot.greenReceivedG)+.005){
      problem="verde-insuficiente";return;
    }
    const [existing]=await tx.select({id:roastContractBatches.id})
      .from(roastContractBatches)
      .where(and(eq(roastContractBatches.lotId,lotId),eq(roastContractBatches.batchCode,code))).limit(1);
    if(existing){problem="batch-duplicado";return;}
    await tx.insert(roastContractBatches).values({
      organizationId,lotId,batchCode:code,
      roastedAt,greenG:String(round2(green)),roastedG:String(round2(roasted)),
      profile:val(data,"profile").slice(0,180)||null,
      firstCrackC:fc===null?null:String(round2(fc)),
      dropC:drop===null?null:String(round2(drop)),
      durationS:duration,dtrPct:dtr===null?null:String(dtr),
      greenDefectSampleG:sample===null?null:String(round2(sample)),
      defects,sensoryNotes:val(data,"sensoryNotes").slice(0,1200)||null,
      qualityNotes:val(data,"qualityNotes").slice(0,1200)||null,
    });
  });
  if(problem)fail(problem,lotId);
  refresh();
  redirect(ROUTE+"?ok=batch&lot="+lotId);
}

export async function createContractDelivery(data:FormData){
  const {organizationId}=await requirePermission("roast.manage");
  const batchId=val(data,"batchId"),grams=num(data,"grams");
  if(!finite(grams,.01,100000))fail("entrega-invalida");
  const db=getDb();
  let problem="",lotId="";
  await db.transaction(async tx=>{
    const [batch]=await tx.select().from(roastContractBatches)
      .where(and(eq(roastContractBatches.id,batchId),eq(roastContractBatches.organizationId,organizationId)))
      .for("update").limit(1);
    if(!batch){problem="batch-inexistente";return;}
    lotId=batch.lotId;
    const [total]=await tx.select({total:sql<string>`coalesce(sum(${roastContractDeliveries.grams}),0)`})
      .from(roastContractDeliveries).where(eq(roastContractDeliveries.batchId,batchId));
    if(round2(Number(total.total)+grams)>Number(batch.roastedG)+.005){
      problem="entrega-supera-tostado";return;
    }
    await tx.insert(roastContractDeliveries).values({organizationId,batchId,
      grams:String(round2(grams)),recipient:val(data,"recipient").slice(0,160)||null,
      notes:val(data,"notes").slice(0,1200)||null});
  });
  if(problem)fail(problem,lotId);
  refresh();
  redirect(ROUTE+"?ok=entrega&lot="+lotId);
}

export async function setContractLotStatus(data:FormData){
  const {organizationId}=await requirePermission("roast.manage");
  const lotId=val(data,"lotId"),status=val(data,"status");
  if(!["OPEN","CLOSED"].includes(status))fail("estado-invalido");
  const db=getDb();
  const [result]=await db.update(roastContractLots).set({status,updatedAt:new Date()})
    .where(and(eq(roastContractLots.id,lotId),eq(roastContractLots.organizationId,organizationId)))
    .returning({id:roastContractLots.id});
  if(!result)fail("lote-inexistente");
  refresh();
  redirect(ROUTE+"?ok=estado&lot="+lotId);
}
