import Link from "next/link";
import { getOpenPosOrders } from "@/src/application/pos/orders";
import { getCashState } from "@/src/application/pos/cash";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission, employeeHasPermission } from "@/src/infrastructure/auth/permissions";
import { CheckoutPaymentForm } from "./payment-form";

export const dynamic="force-dynamic";
const money=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});

export default async function PosCheckoutPage({searchParams}:{
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}){
  const params=await searchParams;
  const orderId=typeof params.ticket==="string"?params.ticket:"";
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const [orders,cash,canOverrideStock]=await Promise.all([
    getOpenPosOrders(employee.organizationId,employee.homeStoreId),
    getCashState(employee.organizationId,employee.homeStoreId),
    employeeHasPermission(employee.id,"inventory.adjust",employee.homeStoreId),
  ]);
  const order=orders.find(o=>o.id===orderId&&o.mode==="LIVE");
  const error=typeof params.error==="string"?params.error.slice(0,340):null;
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div>
        <p className="eyebrow">POS LIVE · CAJA</p>
        <h1>Cobrar ticket guardado</h1>
        <p className="muted">Selecciona el método de pago antes de registrar el cobro. La cuenta conserva el folio original.</p>
      </div>
      <Link href={order?"/pos?ticket="+order.id:"/pos"} className="button">Volver al POS</Link>
    </section>
    {error&&<section className="card" role="alert">
      <p className="status-bad">No se cobró: {error}</p>
      <p className="muted">El ticket sigue abierto. Corrige la existencia física o, si ya se entregó el pedido, solicita autorización del propietario.</p>
    </section>}
    {!order?<section className="card stack">
      <h2>Ticket no disponible</h2>
      <p>El ticket podría estar cobrado, cancelado o cerrado. No se ejecutó ningún cobro adicional.</p>
      <Link className="button" href="/pos">Volver al POS</Link>
    </section>:
    <div className="grid-two">
      <section className="card stack">
        <p className="eyebrow">TICKET GUARDADO</p>
        <h2>{order.tableLabel??"Mesa"} · {order.folio}</h2>
        <div className="stack">
          {order.lines.map(line=><div key={line.id} className="receipt-line" style={{display:"flex",justifyContent:"space-between",gap:12}}>
            <span>{Number(line.quantity)}× {line.name}
              <small style={{display:"block"}}>{line.expectedConsumption?.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí"}{line.note?" · "+line.note:""}</small>
            </span>
            <strong>{money.format(Number(line.lineTotal))}</strong>
          </div>)}
        </div>
        <div className="pos-total"><span>Total</span><strong>{money.format(Number(order.total))}</strong></div>
        <Link href={"/pos/orders/"+order.id+"/split"} className="button">
          Dividir cuenta · asignar productos y cobrar por separado
        </Link>
        <p className="muted">Si empiezas a dividir, termina los cobros desde las cuentas divididas.</p>
      </section>
      <CheckoutPaymentForm key={order.id} orderId={order.id}
        total={Number(order.total)}
        cashOpen={Boolean(cash.session)}
        canOverrideStock={canOverrideStock}
        partialPaid={order.status==="PARTIALLY_PAID"}/>
    </div>}
  </main>;
}
