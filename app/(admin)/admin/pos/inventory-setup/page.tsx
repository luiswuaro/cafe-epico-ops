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
      <p className="muted">Una fuente fraccionaria puede representar kilogramos o litros. Confirma la unidad: g cuando el origen es kg, ml cuando el origen es L. Si Loyverse registra masa y necesitas volumen, primero debes calcular la conversión con la densidad medida; no elijas ml por el nombre del líquido.</p>
      <p className="muted">La cifra «apariciones» cuenta las recetas/configuraciones que usan el ingrediente (aquí y para llevar), no ventas realizadas.</p>
      <p className="muted">Agua y hielo sin saldo en Loyverse requieren tu decisión y un conteo/estimación autorizada antes de incorporarlos al inventario. El sistema no asignará cero o cantidades inventadas.</p>
      {!setup.sourceStore && <p className="alert">No hay una tienda Loyverse única identificada. No se puede importar.</p>}
    </section>
    {setup.sourceStore && missing.length>0 && <form action={confirmPosInventorySetup} className="stack">
      <section className="card stack">
        <h2>Saldos físicos y unidades</h2>
        {missing.map(item=>{
          const quantity = item.sourceQuantity;
          const sourceLabel=quantity==null ? "Sin saldo reportado" : item.weighted
            ? quantity.toFixed(3)+" (fraccionario) · factor 1000 pendiente de unidad"
            : quantity.toFixed(0)+" pz";
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
                {item.weighted
                  ? <select name={"unit:"+item.id} defaultValue="">
                    <option value="">Seleccionar</option>
                    <option value="g">g (origen kg)</option>
                    <option value="ml">ml (origen L)</option>
                  </select>
                  : <><input name={"unit:"+item.id} type="hidden" value="pz"/>
                    <p><strong>pz</strong></p></>}
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
