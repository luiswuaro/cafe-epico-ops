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
}){
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada.");
  await assertEmployeePermission(employee.id,"integration.manage",employee.homeStoreId);
  const setup=await getPosInventorySetup(employee.organizationId,employee.homeStoreId);
  const params=await searchParams;
  const missing=setup.candidates.filter(c=>!c.mapped);
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div><p className="eyebrow">GESTIÓN · PREPARACIÓN LIVE</p>
        <h1>Confirmar inventario POS</h1>
        <p className="muted">Importación trazable de componentes de recetas Loyverse a insumos internos OPS, con cantidades verificadas por un responsable.</p>
      </div>
      <Link className="button" href="/pos/inventory-audit">Volver a auditoría</Link>
    </section>
    <section className="card stack">
      <h2>Inventario incompleto: {missing.length} insumos por confirmar</h2>
      <p>Recetas de productos consultadas: {setup.products}. Componentes sin ID: {setup.unsupported}. Ya mapeados: {setup.alreadyMapped}.</p>
      {params.added && <p role="status">Se registraron {params.added} saldos iniciales. Continúa revisando los que faltan.</p>}
      <p className="muted">Los saldos sugeridos provienen de Loyverse y podrían no coincidir con los existentes físicamente. Debes contar y escribir el saldo real: no se copiarán automáticamente.</p>
      <p className="muted">Por ahora las cantidades fraccionarias se convierten de kg a g (×1000), incluso líquidos pesados por báscula; las piezas permanecen en pz. Se requiere revisar las unidades antes de confirmar.</p>
      {!setup.sourceStore && <p className="alert">No se encontró una tienda Loyverse única. No es posible importar automáticamente.</p>}
    </section>
    {setup.sourceStore && missing.length>0 && <form action={confirmPosInventorySetup} className="stack">
      <section className="card stack">
        <h2>Registrar saldos por insumo</h2>
        {missing.map(item=>{
          const suggested=item.suggested;
          return <div className="task" key={item.id} style={{display:"grid",gridTemplateColumns:"minmax(170px,2fr) minmax(110px,1fr) minmax(150px,1fr)",gap:12,alignItems:"center"}}>
            <div>
              <label><input type="checkbox" name={"selected:"+item.id} value="yes" /> <strong>{item.name}</strong></label>
              <p className="muted">Loyverse: {suggested==null?"Sin saldo reportado":suggested.toFixed(3)+" "+item.unit} · {item.category} usos en recetas</p>
              {!item.sourceAvailable && <p className="status-warn">Variante no sincronizada: requiere revisión individual.</p>}
            </div>
            <label>Cantidad física ({item.unit})
              <input name={"quantity:"+item.id} type="number" min={0} step={0.001} placeholder="Contar" />
            </label>
            <label>Ubicación
              <select name={"location:"+item.id} defaultValue={setup.locations.find(l=>l.name==="Barra")?.id??setup.locations[0]?.id}>
                {setup.locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
          </div>;
        })}
        <label>
          <input name="physicalConfirmed" type="checkbox" value="yes" required /> Confirmo que revisé las unidades, ubicaciones y cantidades físicas de TODOS los artículos seleccionados.
        </label>
        <button type="submit">Crear únicamente los insumos seleccionados y confirmados</button>
      </section>
    </form>}
  </main>;
}
