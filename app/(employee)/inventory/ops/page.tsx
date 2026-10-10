import Link from "next/link";
import { SearchableCollection } from "@/components/searchable-collection";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission, employeeHasPermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryBalances, inventoryItems, inventoryLocations,
  inventoryMovements,
} from "@/src/infrastructure/db/schema";
import { createOpsInventoryItem, registerOpsInventoryMovement } from "./actions";

export const dynamic = "force-dynamic";
const qty = new Intl.NumberFormat("es-MX", {maximumFractionDigits:3});
function when(date:Date) {
  return new Intl.DateTimeFormat("es-MX",{
    timeZone:"America/Mexico_City",dateStyle:"short",timeStyle:"short",
  }).format(date);
}
function operationTitle(type:string) {
  if (type==="PURCHASE") return "Entrada / compra";
  if (type==="WASTE") return "Merma";
  if (type==="COUNT_ADJUSTMENT") return "Ajuste por conteo";
  if (type==="MANUAL_ADJUSTMENT") return "Salida manual";
  if (type==="OPENING_BALANCE") return "Saldo inicial";
  if (type==="SALE") return "Venta POS";
  return type;
}

export default async function OpsInventoryPage({
  searchParams,
}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId) throw new Error("Empleado sin sucursal.");
  await assertEmployeePermission(employee.id,"inventory.read",employee.homeStoreId);
  const [canAdjust,canCreate]=await Promise.all([
    employeeHasPermission(employee.id,"inventory.adjust",employee.homeStoreId),
    employeeHasPermission(employee.id,"inventory.item.manage",employee.homeStoreId),
  ]);
  const db=getDb();
  const [balances,locations,movements]=await Promise.all([
    db.select({
      id:inventoryItems.id,name:inventoryItems.name,category:inventoryItems.category,
      sku:inventoryItems.sku,unit:inventoryItems.canonicalUnit,
      minimum:inventoryItems.minimumStock,locationId:inventoryBalances.locationId,
      theoretical:inventoryBalances.theoreticalQuantity,
      trackingType:inventoryItems.trackingType,
    }).from(inventoryBalances).innerJoin(inventoryItems,eq(inventoryItems.id,inventoryBalances.inventoryItemId))
      .where(and(eq(inventoryBalances.organizationId,employee.organizationId),
        eq(inventoryBalances.storeId,employee.homeStoreId),
        eq(inventoryItems.isActive,true)))
      .orderBy(inventoryItems.name),
    db.select({id:inventoryLocations.id,name:inventoryLocations.name})
      .from(inventoryLocations).where(and(
        eq(inventoryLocations.organizationId,employee.organizationId),
        eq(inventoryLocations.storeId,employee.homeStoreId),
        eq(inventoryLocations.isActive,true),
      )),
    db.select({
      id:inventoryMovements.id,occurredAt:inventoryMovements.occurredAt,
      itemName:inventoryItems.name,unit:inventoryItems.canonicalUnit,
      type:inventoryMovements.movementType,delta:inventoryMovements.quantityDelta,
      note:inventoryMovements.note,employeeId:inventoryMovements.employeeId,
      source:inventoryMovements.sourceType,
    }).from(inventoryMovements).innerJoin(inventoryItems,eq(inventoryItems.id,inventoryMovements.inventoryItemId))
      .where(and(eq(inventoryMovements.organizationId,employee.organizationId),
        eq(inventoryMovements.storeId,employee.homeStoreId)))
      .orderBy(desc(inventoryMovements.occurredAt)).limit(70),
  ]);
  const locationNames=new Map(locations.map(l=>[l.id,l.name]));
  const available=balances.filter(b=>b.trackingType==="QUANTITY");
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div>
        <p className="eyebrow">CAFÉ ÉPICO · INVENTARIO INTERNO</p>
        <h1>Inventario OPS</h1>
        <p className="muted">Inventario oficial de Café Épico. Ventas, compras, mermas y ajustes se reflejan en existencias OPS con historial auditable.</p>
      </div>
      <div className="pos-result-actions">
        <Link className="button" href="/pos/inventory-audit">Auditar recetas</Link>
      </div>
    </section>
    {(params.posted||params.created)&&<section className="card status-ok" role="status">
      {params.created?"Insumo creado y saldo inicial registrado.":params.posted==="nochange"?"Conteo sin diferencias; no se creó movimiento.":"Movimiento de inventario registrado y auditado."}
    </section>}
    <section className="card stack">
      <h2>Existencias OPS · {available.length} renglones</h2>
      <p className="muted">El agua potable y el hielo propio se contabilizan únicamente en el escandallo y no aparecen como existencias descontables. Para sumar compras utiliza «Entrada». Para corregir después de contar utiliza «Ajuste por conteo», que reemplaza la cantidad actual (no la suma).</p>
      {available.length===0&&<p>No hay insumos registrados. Da de alta los productos existentes desde este inventario.</p>}
      <SearchableCollection
        label="insumos de inventario"
        placeholder="Ej. leche, maracuyá, vaso, SKU..."
        categoryLabel="Unidad de control"
        statusLabel="Existencias"
        entries={available.map(item=>{
          const current=Number(item.theoretical);
          const low=item.minimum!=null && current<Number(item.minimum);
          const state=current<=0 ? "AGOTADO" : low ? "BAJO MÍNIMO" : "DISPONIBLE";
          return {
            id:item.id+"-"+item.locationId,
            name:item.name,
            category:item.unit,
            status:state,
            searchText:[
              item.sku??"",item.category,
              locationNames.get(item.locationId)??"",
            ].join(" "),
            content: <details className="task" style={{padding:16}}>
          <summary>
            <strong>{item.name}</strong> · <strong>{qty.format(current)} {item.unit}</strong>
            {low&&<span className="status-warn"> · BAJO</span>}
            <span className="muted"> · {locationNames.get(item.locationId)??"Ubicación"}</span>
          </summary>
          <div className="stack" style={{marginTop:12}}>
            <p className="muted">Existencia actual: {qty.format(current)} {item.unit}. Cada movimiento conserva cantidad anterior, diferencia, responsable y motivo.</p>
            {canAdjust
              ? <form action={registerOpsInventoryMovement} className="stack">
                <input type="hidden" name="operationId" value={randomUUID()}/>
                <input type="hidden" name="itemId" value={item.id}/>
                <input type="hidden" name="locationId" value={item.locationId}/>
                <label>Operación
                  <select name="operation" defaultValue="PURCHASE" required>
                    <option value="PURCHASE">Entrada por compra o reabasto (+)</option>
                    <option value="CONSUMPTION">Salida manual por uso, purga o calibración (−)</option>
                    <option value="WASTE">Merma / desperdicio (−)</option>
                    <option value="COUNT_ADJUSTMENT">Ajustar a una existencia física (valor final)</option>
                  </select>
                </label>
                <label>Cantidad en {item.unit}
                  <input type="number" name="quantity" inputMode="decimal" min="0" max="10000000" step="0.001" required placeholder={"Ej. 100 "+item.unit}/>
                </label>
                <p className="muted">En «Entrada», «Salida» o «Merma», captura la cantidad que cambió. En «Ajustar», escribe el total que contaste físicamente.</p>
                <label>Motivo / referencia
                  <input name="reason" required minLength={3} maxLength={500} placeholder="Factura, purga de molino o motivo del conteo"/>
                </label>
                <button type="submit">Confirmar movimiento de {item.name}</button>
              </form>
              : <p className="status-warn">Tu rol no tiene permiso para modificar existencias.</p>}
          </div>
            </details>,
          };
        })}
      />
    </section>
    {canAdjust&&canCreate&&<section className="card stack">
      <h2>Crear insumo interno nuevo</h2>
      <p className="muted">Comprueba primero que el insumo no exista en OPS para evitar duplicados. La receta y la ubicación se configuran independientemente.</p>
      <form action={createOpsInventoryItem} className="stack">
        <input type="hidden" name="operationId" value={randomUUID()}/>
        <label>Nombre del insumo<input name="name" required minLength={2} maxLength={150}/></label>
        <label>Categoría<input name="category" required minLength={2} maxLength={80} defaultValue="INSUMOS" /></label>
        <label>SKU (opcional)<input name="sku" maxLength={80}/></label>
        <label>Unidad de control<select name="unit" defaultValue="g">
          <option value="g">Gramos</option><option value="ml">Mililitros</option><option value="pz">Piezas</option>
        </select></label>
        <label>Saldo inicial físico<input name="initialQuantity" type="number" min="0" step="0.001" required defaultValue="0"/></label>
        <label>Ubicación<select name="locationId" required>
          {locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}
        </select></label>
        <label>Motivo<input name="note" required minLength={3} maxLength={500} defaultValue="Alta por conteo físico"/></label>
        <button type="submit">Crear insumo con saldo inicial</button>
      </form>
    </section>}
    <section className="card stack">
      <h2>Historial de movimientos OPS</h2>
      <p className="muted">Últimos 70 movimientos: apertura, ventas, entradas, pérdidas y correcciones. Los cambios nunca sobrescriben el historial.</p>
      {movements.length===0&&<p>Sin movimientos todavía.</p>}
      <SearchableCollection
        label="movimientos de inventario"
        placeholder="Ej. Azucena, leche, merma, compra, conteo..."
        categoryLabel="Unidad"
        statusLabel="Movimiento"
        entries={movements.map(m=>({
          id:m.id,
          name:m.itemName,
          category:m.unit,
          status:operationTitle(m.type),
          searchText:[m.note??"",m.source,m.type,when(m.occurredAt),m.employeeId??""].join(" "),
          content:<div className="task">
        <div>
          <strong>{m.itemName}</strong> · {operationTitle(m.type)}
          <p className="muted">{when(m.occurredAt)} · {m.note||"Sin nota"} · Ref. {m.source}</p>
        </div>
        <strong className={Number(m.delta)<0?"status-warn":"status-ok"}>
          {Number(m.delta)>0?"+":""}{qty.format(Number(m.delta))} {m.unit}
        </strong>
          </div>,
        }))}
      />
    </section>
  </main>;
}
