import Link from "next/link";
import {createSupplier,updatePurchaseLine,updatePurchasePlan,addManualPurchaseLine} from "./actions";
import {saveNativePurchaseItem,createNativePurchasePlan} from "./native-actions";
import {getNativePurchases} from "@/src/application/purchases/native";
import {requirePermission} from "@/src/infrastructure/auth/permissions";

export const dynamic="force-dynamic";
const money=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:2});
const qty=new Intl.NumberFormat("es-MX",{maximumFractionDigits:3});

export default async function PurchasesAdminPage({
  searchParams,
}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;
  const {organizationId}=await requirePermission("purchase.manage");
  const data=await getNativePurchases(organizationId);
  const unknownCosts=data.suggested.filter(row=>row.suggestion?.estimatedCost==null).length;
  const estimated=data.suggested.reduce((sum,row)=>sum+(row.suggestion?.estimatedCost??0),0);

  return <main className="shell">
    <section className="hero">
      <p className="eyebrow">ADMIN · COMPRAS OPS</p>
      <h1>Reabasto e insumos</h1>
      <p className="muted">
        Fuente única: inventario OPS de {data.store.name}. Existencias por ubicación,
        consumos de ventas LIVE y precios por unidad canónica en OPS.
        Los planes históricos se conservan, pero no gobiernan la existencia actual.
      </p>
      <p className="muted">Muestra de consumo: {data.sampleDays} día(s) con ventas pagadas.
        Con menos de 3 días no se extrapola demanda.</p>
    </section>
    {params.setting==="saved"&&<p className="card status-ok" role="status">
      Configuración de compra y costo nativo guardados en OPS.
    </p>}
    {params.supplier==="created"&&<p className="card status-ok">Proveedor registrado.</p>}
    {typeof params.error==="string"&&<p className="card alert" role="alert">
      No se completó la operación ({params.error}). Revisa la cantidad y presentación.
    </p>}
    <section className="grid">
      <article className="card">
        <p className="eyebrow">NECESIDADES REALES</p>
        <div className="metric">{data.suggested.length}</div>
        <p>insumos por reponer de {data.rows.length} inventariados.</p>
        <p className="muted">{data.rows.filter(row=>row.minimum!==null).length}
          {" "}insumos con mínimo configurado.</p>
      </article>
      <article className="card">
        <p className="eyebrow">PRESUPUESTO CONOCIDO</p>
        <div className="metric">{money.format(estimated)}</div>
        <p className={unknownCosts?"status-warn":"muted"}>
          {unknownCosts?unknownCosts+" insumo(s) sin precio: total incompleto":
            "Todos los sugeridos tienen costo configurado."}</p>
      </article>
    </section>
    <section className="grid" style={{marginTop:"1rem"}}>
      <form action={createNativePurchasePlan} className="card stack">
        <h2>Crear requisición OPS</h2>
        <p className="muted">
          Sólo los insumos bajo mínimo o con cobertura insuficiente.
          Se redondea por empaque si está configurado; los costos desconocidos
          nunca se inventan.
        </p>
        <label>Título <input name="title" placeholder="Compra semanal" maxLength={150}/></label>
        <label>Destino <input name="destination" placeholder="Puebla / proveedor" maxLength={120}/></label>
        <label>Fecha <input name="plannedFor" type="date"/></label>
        <button type="submit" disabled={data.suggested.length===0}>
          Crear plan de {data.suggested.length} insumo(s)
        </button>
      </form>
      <form action={createSupplier} className="card stack">
        <h2>Proveedor OPS</h2>
        <label>Nombre <input name="name" required maxLength={150}/></label>
        <label>Ciudad / zona <input name="city" placeholder="Puebla"/></label>
        <label>Contacto <input name="contact" placeholder="WhatsApp, vendedor"/></label>
        <label>Condiciones <input name="notes" placeholder="Entrega, precio, horarios"/></label>
        <button type="submit">Guardar proveedor</button>
      </form>
    </section>
    <section className="card" style={{marginTop:"1rem"}}>
      <h2>Qué comprar y cuánto</h2>
      <p className="muted">
        Cálculo: mínimo (o 3 días de demanda observada) + demanda prevista de 7 días,
        menos existencia OPS. Sin mínimo ni muestra suficiente, no se genera una
        compra automática.
      </p>
      {data.suggested.length===0
        ?<p className="status-ok">No hay compras calculables pendientes.
          Configura mínimos y presentaciones abajo antes de confiar en las sugerencias.</p>
        :<div style={{overflowX:"auto"}}>
          <table style={{width:"100%"}}>
            <thead><tr><th>Insumo</th><th>Disponible</th><th>Promedio/día</th>
              <th>Solicitar</th><th>Presentación</th><th>Estimado</th></tr></thead>
            <tbody>{data.suggested.map(row=><tr key={row.id}>
              <td><strong>{row.name}</strong></td>
              <td>{qty.format(row.stock)} {row.unit}</td>
              <td>{qty.format(row.averageDaily)} {row.unit}</td>
              <td>{qty.format(row.suggestion!.quantity)} {row.unit}</td>
              <td>{row.suggestion!.packages!==null
                ?row.suggestion!.packages+" × "+row.presentation?.name:"Unidad nativa"}</td>
              <td>{row.suggestion!.estimatedCost===null?"Costo pendiente":
                money.format(row.suggestion!.estimatedCost)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
    <section className="card" style={{marginTop:"1rem"}}>
      <h2>Ficha de compra por insumo</h2>
      <p className="muted">
        Define mínimo en g, ml o piezas según la unidad del inventario; el
        precio por caja/paquete registra un costo por unidad nativa. Por ejemplo,
        12 litros de leche = 12,000 ml. No introduzcas 12 si la ficha indica ml.
        El costo histórico de ventas anteriores no se modifica.
      </p>
      <div className="stack">
        {data.rows.map(row=><details className="task" key={row.id}>
          <summary style={{cursor:"pointer"}}><strong>{row.name}</strong>{" · "}
            {qty.format(row.stock)} {row.unit} en OPS{" · "}
            {row.unitCost===null?"Costo pendiente":money.format(row.unitCost)+"/"+row.unit}
            {row.minimum!==null?" · Mínimo "+qty.format(row.minimum):" · Sin mínimo"}
          </summary>
          <form action={saveNativePurchaseItem} className="stack"
            style={{width:"100%",marginTop:".8rem"}}>
            <input type="hidden" name="itemId" value={row.id}/>
            <div className="grid">
              <label>Mínimo ({row.unit})
                <input name="minimum" type="number" min="0" step="0.001"
                  defaultValue={row.minimum??""} placeholder={"Ej. 3000 "+row.unit}/></label>
              <label>Presentación
                <input name="packageName" maxLength={100}
                  defaultValue={row.presentation?.name??""}
                  placeholder="Caja de 12 litros"/></label>
              <label>Cantidad por empaque ({row.unit})
                <input name="packageQuantity" type="number" step="0.001" min="0.001"
                  defaultValue={row.presentation?.canonicalQuantity??""}
                  placeholder="Ej. 12000 ml"/></label>
              <label>Precio de compra del empaque (MXN)
                <input name="packagePrice" type="number" step="0.01" min="0"
                  defaultValue={row.unitCost!==null&&row.presentation
                    ?(Math.round(row.unitCost*row.presentation.canonicalQuantity*100)/100):""}
                  placeholder="Precio total de caja"/></label>
              <label>Proveedor
                <select name="supplierId" defaultValue={row.presentation?.supplierId??""}>
                  <option value="">Sin proveedor</option>
                  {data.suppliers.filter(p=>p.isActive).map(p=>
                    <option value={p.id} key={p.id}>{p.name}{p.city?" · "+p.city:""}</option>)}
                </select></label>
            </div>
            <button type="submit">Guardar insumo OPS</button>
          </form>
        </details>)}
      </div>
    </section>
    <section className="card" style={{marginTop:"1rem"}}>
      <h2>Requisiciones guardadas</h2>
      <p className="muted">Las anteriores importadas de Loyverse quedan como
        referencia histórica. Los nuevos planes usan ID nativo de insumo OPS.</p>
      {data.plans.length===0?<p className="muted">Sin requisiciones todavía.</p>:
        <div className="stack">{data.plans.map(plan=><details className="task"
          key={plan.id} open={params.plan===plan.id}>
          <summary style={{cursor:"pointer"}}>
            <strong>{plan.title}</strong>{" · "}{plan.status}{" · "}
            {plan.estimatedBudget===null?"Presupuesto pendiente":
              money.format(Number(plan.estimatedBudget))}
          </summary>
          <div className="stack" style={{marginTop:".7rem",width:"100%"}}>
            <form action={updatePurchasePlan} className="stack">
              <input type="hidden" name="planId" value={plan.id}/>
              <div className="grid">
                <label>Título <input name="title" defaultValue={plan.title} required/></label>
                <label>Destino <input name="destination" defaultValue={plan.destination??""}/></label>
                <label>Fecha <input type="date" name="plannedFor"
                  defaultValue={plan.plannedFor?.toISOString().slice(0,10)??""}/></label>
                <label>Estado <select name="status" defaultValue={plan.status}>
                  {["DRAFT","PLANNED","PURCHASED","CANCELLED"].map(x=>
                    <option key={x} value={x}>{x}</option>)}
                </select></label>
                <label>Gasto real (MXN)
                  <input name="actualSpend" type="number" min="0" step=".01"
                    defaultValue={plan.actualSpend??""}/></label>
              </div>
              <label>Notas <input name="notes" defaultValue={plan.notes??""}/></label>
              <button type="submit">Actualizar plan</button>
            </form>
            {plan.lines.map(line=><details key={line.id} className="task">
              <summary style={{cursor:"pointer"}}>
                {line.itemNameSnapshot}{" · "}{line.status}{" · "}
                {line.estimatedTotal?money.format(Number(line.estimatedTotal)):
                  "Costo pendiente"}{line.inventoryItemId?" · OPS":" · histórico"}
              </summary>
              <form action={updatePurchaseLine} className="stack"
                style={{width:"100%",marginTop:".5rem"}}>
                <input name="lineId" type="hidden" value={line.id}/>
                <div className="grid">
                  <label>Estado <select name="status" defaultValue={line.status}>
                    {["PENDING","BOUGHT","SKIPPED"].map(v=>
                      <option key={v} value={v}>{v}</option>)}
                  </select></label>
                  <label>Cantidad ({line.inventoryItemId?"unidad OPS":"unidad histórica"})
                    <input type="number" step=".001" min="0" name="requestedNativeQuantity"
                      defaultValue={line.requestedNativeQuantity??""}/></label>
                  <label>Paquetes <input type="number" step=".001" min="0"
                    name="packageCount" defaultValue={line.packageCount??""}/></label>
                  <label>Presentación <input name="packageName"
                    defaultValue={line.packageNameSnapshot??""}/></label>
                  <label>Contenido por empaque <input type="number" step=".001"
                    min="0" name="packageQuantity"
                    defaultValue={line.packageQuantitySnapshot??""}/></label>
                  <label>Costo unitario <input type="number" min="0" step=".0001"
                    name="unitCost" defaultValue={line.unitCostSnapshot??""}/></label>
                  <label>Precio paquete <input type="number" min="0" step=".01"
                    name="packagePrice" defaultValue={line.packagePriceSnapshot??""}/></label>
                  <label>Gasto real <input type="number" min="0" step=".01"
                    name="actualTotal" defaultValue={line.actualTotal??""}/></label>
                </div>
                <label>Proveedor <select name="supplierId" defaultValue={line.supplierId??""}>
                  <option value="">Sin proveedor</option>
                  {data.suppliers.filter(x=>x.isActive).map(x=>
                    <option key={x.id} value={x.id}>{x.name}</option>)}
                </select></label>
                <label>Notas <input name="note" defaultValue={line.note??""}/></label>
                <button type="submit">Guardar línea</button>
              </form>
            </details>)}
            <form action={addManualPurchaseLine} className="stack">
              <input type="hidden" name="planId" value={plan.id}/>
              <h3>Añadir renglón libre</h3>
              <label>Artículo <input name="itemName" required/></label>
              <div className="grid">
                <label>Cantidad <input name="requestedNativeQuantity" type="number"
                  min="0" step=".001"/></label>
                <label>Costo unitario <input name="unitCost" type="number"
                  min="0" step=".0001"/></label>
              </div>
              <label>Nota <input name="note"/></label>
              <label>Proveedor <select name="supplierId">
                <option value="">Sin proveedor</option>
                {data.suppliers.filter(x=>x.isActive).map(x=>
                  <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></label>
              <button type="submit">Añadir renglón manual</button>
            </form>
          </div>
        </details>)}</div>}
    </section>
    <p style={{marginTop:"1rem"}}><Link href="/admin">← Volver a administración</Link></p>
  </main>;
}
