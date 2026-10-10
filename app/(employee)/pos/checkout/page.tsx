import Link from "next/link";
import {and,eq} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {posOrders} from "@/src/infrastructure/db/schema";
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
  // Las cuentas que otro dispositivo acaba de cobrar salen de getOpenPosOrders.
  // Consultar el estado real, restringido por organización y sucursal, antes de
  // mostrar un error genérico que diga incorrectamente "ticket sigue abierto".
  const [current]=!order && /^[0-9a-f-]{36}$/i.test(orderId)
    ?await getDb().select({
      id:posOrders.id,mode:posOrders.mode,status:posOrders.status,
      folio:posOrders.folio,
    }).from(posOrders).where(and(
      eq(posOrders.id,orderId),
      eq(posOrders.organizationId,employee.organizationId),
      eq(posOrders.storeId,employee.homeStoreId),
    )).limit(1)
    :[undefined];
  const paidOrder=!order && current?.mode==="LIVE" && current.status==="PAID" ? current : null;
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
    {paidOrder?<section className="card stack" role="status">
      <p className="status-ok">Esta comanda ya fue cobrada desde otro dispositivo.</p>
      <h2>Pago registrado · {paidOrder.folio}</h2>
      <p>No se generó un segundo cobro. Puedes consultar o imprimir el ticket original.</p>
      <div className="row" style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        <Link className="button" href={"/pos/receipt/"+paidOrder.id}>Ver ticket cobrado</Link>
        <Link className="button" href="/pos">Volver al POS</Link>
      </div>
    </section>:<>
    {error&&<section className="card" role="alert">
      <p className="status-bad">No se cobró: {error}</p>
      {order
        ?<p className="muted">El ticket continúa pendiente. Si faltan insumos, verifica existencias o solicita autorización antes de intentar nuevamente.</p>
        :<p className="muted">Consulta el estado del folio en Comandas antes de intentar de nuevo.</p>}
    </section>}
    {!order?<section className="card stack">
      <h2>Ticket no disponible para cobro</h2>
      <p>El ticket puede estar cancelado, cerrado o ya no disponible. No se ejecutó un cobro adicional.</p>
      <Link className="button" href="/pos/orders">Consultar comandas</Link>
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
        <Link href={"/pos/orders/"+order.id+"/prebill"} className="button pos-prebill-link">
          Ver o imprimir precuenta de mesa
        </Link>
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
    </div>}</>}
  </main>;
}
