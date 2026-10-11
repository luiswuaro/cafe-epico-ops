import Link from "next/link";
import {and,eq} from "drizzle-orm";
import {requirePermission} from "@/src/infrastructure/auth/permissions";
import {getDb} from "@/src/infrastructure/db/client";
import {inventoryItems} from "@/src/infrastructure/db/schema";
import {isPaperBagInventoryItem,isFourCupCarrierInventoryItem} from "@/src/domain/pos/paper-bag-packaging";
import {PackagingSimulator} from "./simulator";
export const dynamic="force-dynamic";
export default async function PackagingAdmin(){
 const {organizationId}=await requirePermission("pos.catalog.manage");
 const bags=await getDb().select({id:inventoryItems.id,name:inventoryItems.name,
    unit:inventoryItems.canonicalUnit,tracking:inventoryItems.trackingType})
   .from(inventoryItems).where(and(eq(inventoryItems.organizationId,organizationId),
     eq(inventoryItems.isActive,true)));
 const matches=bags.filter(i=>isPaperBagInventoryItem({
   name:i.name,unit:i.unit,trackingType:i.tracking,
 }));
 const canDeduct=matches.length===1;
 const carriers=bags.filter(item=>isFourCupCarrierInventoryItem({name:item.name,unit:item.unit,trackingType:item.tracking}));
 return <main className="shell pos-shell">
   <header className="hero pos-hero"><div>
    <p className="eyebrow">CONTROL DE EMPAQUES · OPS</p>
    <h1>Bolsas de alimentos</h1>
    <p className="muted">Una sola regla por pedido para llevar. El cálculo no cambia
     cantidades de alimentos, recetas, puntos ni precios.</p>
   </div>
   <div className="pos-result-actions"><Link className="button" href="/admin/pos/catalog">Catálogo</Link>
    <Link className="button" href="/inventory/ops">Inventario OPS</Link></div>
   </header>
   <section className="card stack">
    <h2>Reglas operativas</h2>
    <p><strong>Hojaldra:</strong> hasta tres piezas por bolsa. Se redondea hacia arriba.</p>
    <p><strong>Croissant de jamón y queso:</strong> una bolsa por pieza.</p>
    <p>Solo para llevar. Los productos para consumir aquí no utilizan bolsa.</p>
    <PackagingSimulator/>
   </section>
   <section className="card stack">
    <h2>Portavasos de 4 · cortesía</h2>
    <p>Se asignan manualmente al tomar un pedido con bebidas para llevar.
       El barista decide si entrega 0, 1 o varias unidades. Precio al cliente: <strong>$0.00</strong>.</p>
    {carriers.length===1?<p className="status-ok">Insumo listo: {carriers[0].name} (pz).
      Descuento de inventario por cantidad efectivamente entregada.</p>:
      <p className="status-warn">Pendiente: registra <strong>PORTAVASOS 4</strong> (pz) en inventario OPS,
      ubicación Barra, con conteo real. No se descontará hasta tener una ficha única.</p>}
   </section>
   <section className="card stack">
    <h2>Control físico de bolsas</h2>
    {canDeduct?<p className="status-ok">Insumo listo: {matches[0].name} · unidad pz.
     Se utilizará al liquidar los pedidos para llevar.</p>:
     <p className="status-warn" role="alert">No se encontró exactamente un insumo activo
      «BOLSA PAPEL» en unidad pz y con control de cantidad.
      {matches.length>1?" Hay duplicados; corrige el catálogo.":""}
      Las bolsas requeridas quedarán señaladas en el registro de venta,
      pero el inventario no puede descontarlas hasta que exista esa ficha.</p>}
    <p>Desde <Link href="/inventory/ops">Inventario OPS</Link> crea
     <strong> BOLSA PAPEL</strong> en <strong>pz</strong>, con ubicación Barra
     y registra el conteo físico. Nunca inventes una existencia inicial.</p>
   </section>
 </main>;
}
