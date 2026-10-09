import Link from "next/link";
import { getPosReadiness } from "@/src/application/pos/readiness";
import { isPosLiveEnabled } from "@/src/application/pos/live";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function LaunchCheckPage(){
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const readiness=await getPosReadiness(employee.organizationId,employee.homeStoreId);
  const live=isPosLiveEnabled();
  const failed=readiness.products.filter(p=>p.recipes.some(r=>!r.ready));
  const successful=readiness.products.filter(p=>p.recipes.every(r=>r.ready));
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div>
        <p className="eyebrow">POS · CORTE DE MIGRACIÓN</p>
        <h1>Verificación para operar sin Loyverse</h1>
        <p className="muted">Auditoría dinámica de recetas descontables, existencias confirmadas y caja antes de autorizar cobros reales en OPS.</p>
      </div>
      <Link href="/pos" className="button">Volver al POS</Link>
    </section>
    <section className="card stack">
      <h2>Estado actual de arranque</h2>
      <p><strong>Recetas listas:</strong> {readiness.ready} de {readiness.total} (cada producto se evalúa aquí y para llevar).</p>
      <p><strong>Recetas bloqueadas:</strong> {readiness.blocked}.</p>
      <p><strong>Caja abierta:</strong> {readiness.cashOpen?"Sí":"NO · abre turno y registra efectivo físico"}.</p>
      <p><strong>Cobro LIVE configurado:</strong> {live?"Activado":"Desactivado por seguridad"}.</p>
      <p><strong>Equivalencias activas:</strong> {readiness.mappings} · <strong>Saldos:</strong> {readiness.balances}.</p>
      {live&&readiness.cashOpen&&readiness.blocked===0
        ? <p className="status-ok">Las comprobaciones automáticas están completas. Aún requiere venta controlada y revisión del arqueo.</p>
        : <p className="status-warn">NO iniciar operación exclusiva en OPS hasta resolver bloqueos y validar cobro y cancelación.</p>}
      <div className="pos-result-actions">
        <Link href="/admin/pos/inventory-setup" className="button">Contar y mapear ingredientes</Link>
        <Link href="/inventory/ops" className="button">Inventario OPS</Link>
        <Link href="/admin/pos/catalog" className="button">Corregir recetas</Link>
        <Link href="/pos/cash" className="button">Caja</Link>
      </div>
    </section>
    <section className="card stack">
      <h2>Requieren trabajo · {failed.length} productos</h2>
      {failed.length===0&&<p className="status-ok">Sin productos bloqueados por esta auditoría.</p>}
      {failed.map(p=><details className="task" key={p.id}>
        <summary><strong>{p.name}</strong> · {p.category}
          {p.recipes.map(r=><span key={r.mode} className={r.ready?"status-ok":"status-warn"}>
            {" · "}{r.mode==="DINE_IN"?"Aquí":"Llevar"}: {r.ready?"Listo":"BLOQUEADO"}
          </span>)}
        </summary>
        <div className="stack" style={{paddingTop:12}}>
          {p.recipes.map(r=><div key={r.mode}>
            <strong>{r.mode==="DINE_IN"?"Aquí":"Para llevar"}</strong>
            {r.ready?<p className="status-ok">Receta y saldo suficientes para una unidad.</p>:
            <ul>{r.errors.map((error,i)=><li key={i}>{error}</li>)}</ul>}
          </div>)}
        </div>
      </details>)}
    </section>
    <section className="card stack">
      <h2>Listos en ambos servicios · {successful.length}</h2>
      <p>{successful.length?successful.map(p=>p.name).join(" · "):"Ningún producto está listo en los dos servicios."}</p>
      <p className="muted">Esta verificación automática no reemplaza la revisión de escandallos, mermas, modificadores, efectivo y facturación.</p>
    </section>
  </main>;
}
