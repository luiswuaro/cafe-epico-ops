import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { isCostOnlyComponent, costOnlyRecipeMeasure } from "@/src/application/pos/component-policy";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryBalances, inventoryItems, inventoryMovements, loyverseInventoryMappings,
} from "@/src/infrastructure/db/schema";

export const dynamic = "force-dynamic";

const when = (date: Date) => new Intl.DateTimeFormat("es-MX", {
  timeZone:"America/Mexico_City",dateStyle:"medium",timeStyle:"short",
}).format(date);

export default async function PosInventoryAuditPage() {
  const {employee} = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const db = getDb();

  const [catalog, items, balances, mappings, movements] = await Promise.all([
    getPosCatalog(employee.organizationId),
    db.select().from(inventoryItems).where(and(
      eq(inventoryItems.organizationId,employee.organizationId),
      eq(inventoryItems.isActive,true),
    )),
    db.select().from(inventoryBalances).where(and(
      eq(inventoryBalances.organizationId,employee.organizationId),
      eq(inventoryBalances.storeId,employee.homeStoreId),
    )),
    db.select().from(loyverseInventoryMappings).where(and(
      eq(loyverseInventoryMappings.organizationId,employee.organizationId),
      eq(loyverseInventoryMappings.storeId,employee.homeStoreId),
      eq(loyverseInventoryMappings.isActive,true),
    )),
    db.select().from(inventoryMovements).where(and(
      eq(inventoryMovements.organizationId,employee.organizationId),
      eq(inventoryMovements.storeId,employee.homeStoreId),
    )).orderBy(desc(inventoryMovements.occurredAt)).limit(100),
  ]);
  const mapped = new Set(mappings.map((row)=>row.loyverseVariantExternalId));
  const byId = new Map(items.map((row)=>[row.id,row]));
  const checks = catalog.map((product)=>{
    const recipes = (["DINE_IN","TAKEAWAY"] as const).map((mode)=>{
      const components = product.serviceRecipes[mode].components;
      const stockComponents = components.filter((x)=>!isCostOnlyComponent(x));
      const covered = stockComponents.filter((x)=>Boolean(x.variantExternalId && mapped.has(x.variantExternalId)));
      return { mode, components, stockComponents, covered:covered.length };
    });
    return { id:product.id, name:product.name, recipes };
  });
  const totalComponents = checks.reduce((sum,p)=>sum+p.recipes.reduce((n,r)=>n+r.stockComponents.length,0),0);
  const costOnlyComponents = checks.reduce((sum,p)=>sum+p.recipes.reduce((n,r)=>n+r.components.length-r.stockComponents.length,0),0);
  const coveredComponents = checks.reduce((sum,p)=>sum+p.recipes.reduce((n,r)=>n+r.covered,0),0);
  const ready = totalComponents>0 && totalComponents===coveredComponents && balances.length>0;

  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div>
        <p className="eyebrow">POS · TRAZABILIDAD</p>
        <h1>Inventario por venta</h1>
        <p className="muted">Auditoría de recetas, equivalencias, saldos y movimientos descontados. La simulación no es consumo real.</p>
      </div>
      <Link href="/pos" className="button">Volver al POS</Link>
    </section>
    <section className="card stack">
      <h2>{ready ? "Mapeo revisable; falta validar el motor LIVE" : "No habilitado para descuentos LIVE"}</h2>
      <p>Insumos registrados: <strong>{items.length}</strong> · Saldos activos: <strong>{balances.length}</strong> · Equivalencias Loyverse → OPS: <strong>{mappings.length}</strong></p>
      <p>Componentes con inventario y equivalencia: <strong>{coveredComponents} de {totalComponents}</strong> (recetas aquí y para llevar).</p>
      <p>Componentes de costo sin inventario: <strong>{costOnlyComponents}</strong> (agua: queda en receta y escandallo, sin conteo ni descuento).</p>
      <p>Movimientos de inventario visibles: <strong>{movements.length}</strong> (últimos 100).</p>
      <p className="muted">La cobertura de equivalencias es sólo una comprobación preliminar. También debemos verificar unidades, densidades, mermas, saldos físicos y modificación por pedido antes de pasar a LIVE.</p>
      <div className="pos-result-actions">
        <Link href="/admin/pos/inventory-setup" className="button">Confirmar inventario inicial en lote</Link>
        <Link href="/admin/loyverse/inventory" className="button">Administrar equivalencias</Link>
        <Link href="/admin/pos/catalog" className="button">Revisar recetas POS</Link>
        <Link href="/inventory" className="button">Consultar inventario</Link>
      </div>
    </section>
    <section className="card stack">
      <h2>Auditoría por bebida</h2>
      {checks.map((p)=> <details key={p.id} className="task">
        <summary><strong>{p.name}</strong> · {p.recipes.map((r)=>r.covered+"/"+r.stockComponents.length).join(" / ")} componentes mapeados (aquí / llevar)</summary>
        <div className="stack" style={{paddingTop:12}}>
          {p.recipes.map((recipe)=><div key={recipe.mode}>
            <h3>{recipe.mode==="DINE_IN"?"Aquí":"Para llevar"}</h3>
            {recipe.components.length===0 && <p className="status-warn">Sin componentes; no existe receta descontable.</p>}
            {recipe.components.map((c,i)=><p key={i} className="muted">
              {c.quantity} {c.unitLabel} · {c.name} · {isCostOnlyComponent(c)
                ? "SOLO COSTO · "+costOnlyRecipeMeasure(c,c.quantity)?.quantity+" g en receta · sin descontar"
                : c.variantExternalId && mapped.has(c.variantExternalId)?"Mapeado":"SIN MAPEAR"}
            </p>)}
          </div>)}
        </div>
      </details>)}
    </section>
    <section className="card stack">
      <h2>Saldos actuales</h2>
      {balances.length===0 && <p className="muted">Todavía no se ha inicializado ningún saldo descontable.</p>}
      {balances.map((b,i)=><p key={i}>
        {byId.get(b.inventoryItemId)?.name??"Insumo no identificado"} ·
        <strong> {Number(b.theoreticalQuantity).toFixed(3)} {byId.get(b.inventoryItemId)?.canonicalUnit??""}</strong>
      </p>)}
    </section>
    <section className="card stack">
      <h2>Movimientos más recientes</h2>
      {movements.length===0 && <p className="muted">Sin movimientos registrados: aún no existe evidencia de descuentos por venta.</p>}
      {movements.map((m)=><p key={m.id} className="task">
        {when(m.occurredAt)} · {byId.get(m.inventoryItemId)?.name??"Insumo"}
        · {m.movementType} · <strong>{Number(m.quantityDelta).toFixed(3)}</strong>
        {m.sourceId?" · Referencia "+m.sourceId:""}
      </p>)}
    </section>
  </main>;
}
