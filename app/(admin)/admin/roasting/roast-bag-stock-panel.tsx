import {randomUUID} from "node:crypto";
import {and,eq,desc} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {
 inventoryBalances,inventoryItems,inventoryLocations,inventoryMovements,
 roastBatches,roastCoffeeLots,roastSettings,
} from "@/src/infrastructure/db/schema";
import {mxRoastDate,roastingItemSku} from "@/src/domain/roasting/stock-ledger";
import {postHiBeanRoastedOutput} from "./inventory-actions";
import {RoastBagTransferForm} from "./roast-bag-transfer-form";
const fmt=new Intl.NumberFormat("es-MX",{maximumFractionDigits:3});
export async function RoastBagStockPanel({organizationId}:{organizationId:string}){
 const db=getDb();
 const [setting]=await db.select().from(roastSettings)
   .where(eq(roastSettings.organizationId,organizationId)).limit(1);
 if(!setting?.defaultStoreId||!setting.defaultLocationId)
   return <section className="card stack" id="bolsa-tolva">
    <h2>Inventario de café tostado · Bolsa → Tolva</h2>
    <p className="status-warn">Configura la sucursal y Almacén seco en Configuración del tostador antes de registrar producción.</p>
   </section>;
 const [lots,batches,movements,items,balances,locations]=await Promise.all([
   db.select().from(roastCoffeeLots).where(and(eq(roastCoffeeLots.organizationId,organizationId),eq(roastCoffeeLots.isActive,true))),
   db.select().from(roastBatches).where(and(eq(roastBatches.organizationId,organizationId),eq(roastBatches.sourceProvider,"HIBEAN"))).orderBy(desc(roastBatches.roastedAt)).limit(500),
   db.select({sourceId:inventoryMovements.sourceId,type:inventoryMovements.movementType})
     .from(inventoryMovements).where(and(eq(inventoryMovements.organizationId,organizationId),
       eq(inventoryMovements.sourceType,"ROAST_BATCH"))),
   db.select().from(inventoryItems).where(and(eq(inventoryItems.organizationId,organizationId),eq(inventoryItems.isActive,true))),
   db.select().from(inventoryBalances).where(and(eq(inventoryBalances.organizationId,organizationId),
     eq(inventoryBalances.storeId,setting.defaultStoreId))),
   db.select().from(inventoryLocations).where(and(eq(inventoryLocations.organizationId,organizationId),
     eq(inventoryLocations.storeId,setting.defaultStoreId),eq(inventoryLocations.isActive,true))),
 ]);
 const output=new Set(movements.filter(m=>m.type==="PRODUCTION_OUTPUT").map(m=>m.sourceId));
 const green=new Set(movements.filter(m=>m.type==="PRODUCTION_CONSUMPTION").map(m=>m.sourceId));
 const barLocation=locations.find(l=>l.name==="Barra");
 const storage=locations.find(l=>l.id===setting.defaultLocationId);
 const barItem=items.find(i=>i.sku==="CAFE-ESPRESSO");
 const barStock=barLocation&&barItem
   ? Number(balances.find(b=>b.locationId===barLocation.id&&b.inventoryItemId===barItem.id)?.theoreticalQuantity??0)
   : null;
 const preview=process.env.VERCEL_ENV==="preview";
 const visible=lots.filter(lot=>batches.some(b=>b.coffeeLotId===lot.id));
 return <section className="card stack" style={{marginTop:"1rem"}} id="bolsa-tolva">
   <p className="eyebrow">TRAZABILIDAD · CAFÉ TOSTADO</p>
   <h2>Bolsa de café tostado → Tolva de espresso</h2>
   <p className="muted">Los batches HiBean pueden mezclarse en una bolsa por lote. Registra la salida tostada de cada batch una sola vez y después transfiere los gramos que pesaste, sin alterar el café que ya había en la tolva.</p>
   {preview&&<p className="status-warn">Modo PREVIEW: simulación visual sin escribir movimientos de inventario en producción.</p>}
   {storage?.locationType!=="STORAGE"&&<p className="status-warn">La ubicación de producción debe ser Almacén seco.</p>}
   {barStock===null&&<p className="status-warn">Falta insumo CAFE-ESPRESSO o ubicación Barra en la sucursal configurada.</p>}
   {visible.length===0&&<p>No hay batches HiBean vinculados a lotes activos.</p>}
   {visible.map(lot=>{
     const sku=roastingItemSku(lot.id);
     const storedItem=items.find(i=>i.sku===sku);
     const stockG=storedItem?Number(balances.find(b=>
       b.inventoryItemId===storedItem.id&&b.locationId===setting.defaultLocationId)?.theoreticalQuantity??0):0;
     const batchRows=batches.filter(b=>b.coffeeLotId===lot.id);
     const buckets=new Map<string,{count:number;qty:number;unposted:number}>();
     for(const b of batchRows){
       const date=mxRoastDate(b.roastedAt);
       const x=buckets.get(date)??{count:0,qty:0,unposted:0};
       if(!output.has(b.id)&&green.has(b.id)){
         x.count++;
         x.qty+=Number(b.roastedWeightG);
         x.unposted++;
       }else if(!output.has(b.id))x.unposted++;
       buckets.set(date,x);
     }
     const dates=[...buckets.entries()].filter(([,entry])=>entry.unposted>0);
     const maxProjected=dates.length?dates[0][1].qty:0;
     return <article className="task" key={lot.id} style={{display:"block",padding:16}}>
       <h3>{lot.name}</h3>
       <p className="muted">Lote HiBean · SKU de bolsa {sku} · Tostado por batch, almacenado en bolsa común</p>
       <div className="grid">
         <div><small className="muted">Bolsa · Almacén seco (contabilizado)</small>
           <p className="metric">{fmt.format(stockG)} g</p>
         </div>
         <div><small className="muted">Tolva · Café espresso en grano (saldo existente)</small>
           <p className="metric">{barStock===null?"—":fmt.format(barStock)+" g"}</p>
         </div>
       </div>
       {dates.length>0&&<div className="stack">
         <h4>Entradas de producción pendientes</h4>
         <p className="muted">Selecciona únicamente la fecha cuyos batches conservas físicamente. OPS no volverá a descontar el café verde.</p>
         {dates.map(([date,v])=><form action={postHiBeanRoastedOutput} key={date}
           className="task" style={{alignItems:"center"}}>
           <input type="hidden" name="lotId" value={lot.id}/>
           <input type="hidden" name="roastDate" value={date}/>
           <input type="hidden" name="confirmProduction" value="yes"/>
           <div style={{flex:1}}><strong>{date} · {v.count} batches</strong>
             <p className="muted">Por ingresar: {fmt.format(v.qty)} g de tostado
             {v.unposted>v.count?" · algunos sin descuento verde confirmado":""}</p>
           </div>
           <button type="submit" disabled={preview||storage?.locationType!=="STORAGE"||v.count!==v.unposted}>
             Registrar producción
           </button>
         </form>)}
       </div>}
       <h4>Enviar a tolva por gramos</h4>
       <RoastBagTransferForm lotId={lot.id} bagG={stockG} barG={barStock??0}
         previewPendingG={maxProjected} preview={preview}
         canTransfer={Boolean(storedItem&&barStock!==null&&stockG>0&&storage?.locationType==="STORAGE")}
         operationId={randomUUID()}/>
     </article>;
   })}
 </section>;
}
