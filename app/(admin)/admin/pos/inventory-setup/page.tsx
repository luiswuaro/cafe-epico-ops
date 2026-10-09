import Link from "next/link";
import { getPosInventorySetup } from "@/src/application/pos/inventory-setup";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { confirmPosInventorySetup } from "./actions";

export const dynamic = "force-dynamic";

export default async function InventorySetupPage({
  searchParams,
}:{
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}) {
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada.");
  await assertEmployeePermission(employee.id,"integration.manage",employee.homeStoreId);
  const setup=await getPosInventorySetup(employee.organizationId,employee.homeStoreId);
  const params=await searchParams;
  const missing=setup.candidates.filter(c=>!c.mapped);
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div>
        <p className="eyebrow">GESTIÓN · PREPARACIÓN LIVE</p>
        <h1>Confirmar inventario POS</h1>
        <p className="muted">Relaciona ingredientes de Loyverse con insumos OPS. El saldo inicial se registra únicamente después de tu conteo.</p>
      </div>
      <Link className="button" href="/pos/inventory-audit">Volver a auditoría</Link>
    </section>
    <section className="card stack">
      <h2>Insumos pendientes: {missing.length}</h2>
      <p>Productos analizados: {setup.products} · Componentes sin identificador: {setup.unsupported} · Equivalencias existentes: {setup.alreadyMapped}.</p>
      {params.added && <p role="status">Se crearon {params.added} registros iniciales. Revisa los pendientes.</p>}
      <p><strong>Las cifras de Loyverse son referencias, no un conteo físico validado.</strong></p>
      <p className="muted">Unidades de barra confirmadas: leche deslactosada L → ml; demás ingredientes fraccionarios kg → g; empaques y desechables → pz. Las cantidades físicas siguen pendientes de conteo.</p>
      <p className="muted">La cifra «apariciones» cuenta las recetas/configuraciones que usan el ingrediente (aquí y para llevar), no ventas realizadas.</p>
      <p className="muted"><strong>Agua: SOLO COSTO.</strong> Se conserva la cantidad en las recetas para calcular el escandallo cuando se configure su precio por gramo; no se captura existencia ni se descuenta durante ventas. El hielo, si aparece en las recetas, continúa sujeto a conteo y control de inventario.</p>
      <p className="muted">Apariciones de agua sin inventario en recetas: {setup.costOnlyOccurrences}. No se incluyen entre los insumos pendientes.</p>
      {!setup.sourceStore && <p className="alert">No hay una tienda Loyverse única identificada. No se puede importar.</p>}
    </section>
    {setup.sourceStore && missing.length>0 && <form action={confirmPosInventorySetup} className="stack">
      <section className="card stack">
        <h2>Saldos físicos y unidades</h2>
        {missing.map(item=>{
          const quantity = item.sourceQuantity;
          const sourceUnit=item.officialUnit==="ml" ? "L" : item.officialUnit==="g" ? "kg" : "pz";
          const sourceLabel=quantity==null ? "Sin saldo reportado" :
            quantity.toFixed(item.weighted?3:0)+" "+sourceUnit+" → "+
            (item.suggested ?? 0).toFixed(item.weighted?3:0)+" "+item.officialUnit;
          return <div key={item.id} style={{
            display:"flex",flexWrap:"wrap",gap:14,alignItems:"flex-start",
            padding:"14px 0",borderBottom:"1px solid #d9d3ca",
          }}>
            <div style={{flex:"2 1 220px"}}>
              <label style={{display:"flex",alignItems:"center",gap:10}}>
                <input type="checkbox" name={"selected:"+item.id} value="yes"
                  style={{width:20,height:20,flex:"none",margin:0}} />
                <strong>{item.name}</strong>
              </label>
              <p className="muted">Loyverse: {sourceLabel}</p>
              <p className="muted">Aparece en {item.recipeAppearances} configuraciones de receta.</p>
              {!item.sourceAvailable && <p className="status-warn">Variante sin datos suficientes: revisión manual obligatoria.</p>}
            </div>
            <div style={{flex:"1 1 130px",minWidth:120}}>
              <label>Unidad confirmada
                <input name={"unit:"+item.id} type="hidden" value={item.officialUnit}/>
                <p><strong>{item.officialUnit}</strong></p>
              </label>
            </div>
            <div style={{flex:"1 1 140px",minWidth:125}}>
              <label>Cantidad física
                <input name={"quantity:"+item.id} type="number" min={0} step={0.001}
                  placeholder="Conteo real" />
              </label>
            </div>
            <div style={{flex:"1 1 155px",minWidth:150}}>
              <label>Ubicación
                <select name={"location:"+item.id} defaultValue={setup.locations.find(l=>l.name==="Barra")?.id??setup.locations[0]?.id}>
                  {setup.locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
            </div>
            <div style={{flex:"1 1 190px",minWidth:185}}>
              <label>Insumo existente (opcional)
                <select name={"existingItem:"+item.id} defaultValue="">
                  <option value="">Crear insumo nuevo</option>
                  {setup.reusableItems.map(existing=><option key={existing.id} value={existing.id}>
                    {existing.name} ({existing.unit})
                  </option>)}
                </select>
              </label>
            </div>
          </div>;
        })}
        <label style={{display:"flex",gap:10,alignItems:"center"}}>
          <input name="physicalConfirmed" type="checkbox" value="yes" required
            style={{width:20,height:20,flex:"none",margin:0}} />
          <span>Confirmo que conté los insumos seleccionados y revisé sus unidades y ubicaciones.</span>
        </label>
        <button type="submit">Registrar solamente los insumos seleccionados</button>
        <p className="muted">Este registro sí actualiza inventario compartido. No lo uses como prueba ficticia.</p>
      </section>
    </form>}
  </main>;
}
