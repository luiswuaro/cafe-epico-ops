import Link from "next/link";
import { getPosCustomers } from "@/src/application/pos/customers";
import { getCustomerPurchaseProfile } from "@/src/application/pos/customer-purchases";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { PurchaseCard } from "../purchase-card";

export const dynamic = "force-dynamic";

export default async function CustomerInsightsPage({searchParams}: {
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  const params=await searchParams;
  const customerId=typeof params.customer==="string" ? params.customer : "";
  const query=typeof params.q==="string" ? params.q.trim().slice(0,80) : "";
  const page=typeof params.page==="string" ? Number(params.page)||1 : 1;
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId) throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const customers=await getPosCustomers(employee.organizationId);
  const selected=customers.find(c=>c.id===customerId);
  const profile=selected ? await getCustomerPurchaseProfile({
    organizationId:employee.organizationId,
    storeId:employee.homeStoreId,
    customerId:selected.id,page,
  }):null;
  const filtered=customers.filter((c)=>{
    const text=[c.name,c.phone??"",c.email??""].join(" ").toLocaleLowerCase("es-MX");
    return text.includes(query.toLocaleLowerCase("es-MX"));
  });
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div>
        <p className="eyebrow">CLIENTES · INTELIGENCIA COMERCIAL</p>
        <h1>Visitas y bebidas favoritas</h1>
        <p className="muted">Análisis por ID, sin asignar tickets anónimos ni duplicar ventas espejo.</p>
      </div>
      <Link href="/pos/customers" className="button">Volver a clientes</Link>
    </section>
    {profile && <PurchaseCard profile={profile} customerId={selected!.id} />}
    <section className="card stack">
      <h2>Seleccionar cliente ({customers.length})</h2>
      <form method="get" action="/pos/customers/insights" className="stack">
        <label>Buscar por nombre o contacto
          <input name="q" type="search" defaultValue={query} maxLength={80}/>
        </label>
        <button type="submit">Buscar</button>
      </form>
      {filtered.length===0 && <p className="muted">Sin coincidencias.</p>}
      {filtered.map(c=><Link className="task" key={c.id}
        href={"/pos/customers/insights?customer="+c.id}>
        <strong>{c.name}</strong>
        <span className="muted">{Number(c.pointsBalance).toFixed(2)} pts</span>
      </Link>)}
      <p className="muted">La actividad visible corresponde a los recibos Loyverse sincronizados y, cuando existan, a ventas OPS LIVE no duplicadas.</p>
    </section>
  </main>;
}
