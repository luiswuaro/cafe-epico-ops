"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { addProductsToLiveCommand } from "./orders/live-actions";
import {
  createPosCustomer,
  createLiveCommand,
  createShadowCommand,
  createShadowSale,
} from "./actions";
import { createLiveSale } from "./live-actions";

type CatalogItem = {
  id: string;
  name: string;
  category: "CALIENTES" | "FRÍAS" | "ALIMENTOS";
  price: number;
};

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  pointsBalance: number;
};

type ServiceMode="DINE_IN"|"TAKEAWAY";
type CartLine = {
  key:string;externalId:string;note:string;serviceMode:ServiceMode;
};
type SavedTicket={
  id:string;folio:string;name:string;total:number;customerId:string|null;
  status:string;serviceMode:ServiceMode;
  lines:Array<{id:string;name:string;quantity:number;note:string|null;unitPrice:number;serviceMode:ServiceMode;isAdditionalRound:boolean;roundId:string|null}>;
};

type Props = {
  catalog: CatalogItem[];
  customers: Customer[];
  selectedCustomerId?: string | null;
  cashOpen: boolean;
  liveEnabled: boolean;
  savedTicket?:SavedTicket|null;
};

function normalizeSearch(value:string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLocaleLowerCase("es-MX").trim();
}

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export function PosClient({
  catalog,
  customers,
  selectedCustomerId = null,
  cashOpen,
  liveEnabled,
  savedTicket=null,
}: Props) {
  const [category, setCategory] = useState<"TODAS" | CatalogItem["category"]>(
    "CALIENTES",
  );
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [serviceMode, setServiceMode] =
    useState<ServiceMode>(savedTicket?.serviceMode??"DINE_IN");
  const [customerId, setCustomerId] = useState(savedTicket?.customerId??selectedCustomerId??"");
  const [additionRequestId]=useState(()=>globalThis.crypto.randomUUID());
  const [liveClientOrderId] = useState(() => globalThis.crypto.randomUUID());
  const [paymentMethod, setPaymentMethod] = useState<"CASH"|"CARD"|"TRANSFER">(cashOpen ? "CASH" : "CARD");
  const [tendered, setTendered] = useState("");

  const catalogById = useMemo(
    () => new Map(catalog.map((item) => [item.id, item])),
    [catalog],
  );

  const visible = useMemo(() => {
    const q = normalizeSearch(query);
    return catalog.filter((item) => {
      const categoryOk = category === "TODAS" || item.category === category;
      const queryOk = !q || normalizeSearch(item.name).includes(q);
      return categoryOk && queryOk;
    });
  }, [catalog, category, query]);

  const cartLines = cart.flatMap((line) => {
    const item = catalogById.get(line.externalId);
    return item ? [{ ...line, item }] : [];
  });

  const historicalRoundIds=[...new Set((savedTicket?.lines??[]).map(line=>line.roundId??"INITIAL"))];
  const newSubtotal=cartLines.reduce((sum,line)=>sum+line.item.price,0);
  const total=(savedTicket?.total??0)+newSubtotal;

  const selectedCustomer =
    customers.find((customer) => customer.id === customerId) ?? null;
  const pointsPreview = selectedCustomer
    ? Math.round(total * 0.05 * 100) / 100
    : 0;

  const productCount = (id: string) =>
    cart.reduce(
      (sum, line) => sum + (line.externalId === id ? 1 : 0),
      0,
    );

  function add(externalId: string) {
    setCart((current) => [
      ...current,
      {
        key: globalThis.crypto.randomUUID(),
        externalId,
        note: "",
        serviceMode,
      },
    ]);
  }

  function remove(key: string) {
    setCart((current) => current.filter((line) => line.key !== key));
  }

  function duplicate(line: CartLine) {
    setCart((current) => [
      ...current,
      {
        key: globalThis.crypto.randomUUID(),
        externalId: line.externalId,
        note: "",
        serviceMode:line.serviceMode,
      },
    ]);
  }

  function updateServiceMode(key:string,next:ServiceMode){
    setCart(current=>current.map(line=>line.key===key?{...line,serviceMode:next}:line));
  }

  function updateNote(key: string, note: string) {
    setCart((current) =>
      current.map((line) => (line.key === key ? { ...line, note } : line)),
    );
  }

  return (
    <div className="pos-layout">
      <section className="pos-catalog">
        <div className="card pos-toolbar">
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if(event.target.value.trim()) setCategory("TODAS");
            }}
            placeholder="Buscar bebida o alimento..."
            aria-label="Buscar producto"
            autoComplete="off"
          />
          {query && <button type="button" className="button" onClick={()=>setQuery("")}>
            Limpiar búsqueda
          </button>}
          <p className="muted" aria-live="polite" style={{margin:0}}>
            {visible.length} de {catalog.length} productos
          </p>
          <div className="pos-category-tabs">
            {(["TODAS", "CALIENTES", "FRÍAS", "ALIMENTOS"] as const).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  className={category === value ? "active" : ""}
                  onClick={() => setCategory(value)}
                >
                  {value === "FRÍAS"
                    ? "Frías"
                    : value === "CALIENTES"
                      ? "Calientes"
                      : value === "ALIMENTOS"
                        ? "Alimentos"
                        : "Todas"}
                </button>
              ),
            )}
          </div>
        </div>

        {visible.length===0 && <p className="card muted" role="status">
          No encontramos productos con esa búsqueda. Cambia el término o selecciona «Todas».
        </p>}
        <div className="pos-product-grid">
          {visible.map((item) => {
            const count = productCount(item.id);
            return (
              <button
                type="button"
                className="pos-product-card"
                key={item.id}
                onClick={() => add(item.id)}
              >
                <span className="eyebrow">{item.category}</span>
                <strong>{item.name}</strong>
                <span>{money.format(item.price)}</span>
                {count > 0 && <span className="pos-product-qty">{count}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="card pos-cart">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{savedTicket?"TICKET GUARDADO":liveEnabled?"VENTA LIVE":"ORDEN ESPEJO"}</p>
            <h2>{savedTicket?.name??"Cuenta"}</h2>
            {savedTicket&&<p className="muted">{savedTicket.folio}</p>}
          </div>
          <span className="pill">{(savedTicket?.lines.reduce((sum,line)=>sum+line.quantity,0)??0)+cartLines.length} unidad(es)</span>
        </div>

        <p className="muted" style={{marginBottom:0}}>Servicio predeterminado de las próximas bebidas. Cada producto puede cambiarse de forma independiente.</p>
        <div className="pos-service-toggle">
          <button
            type="button"
            className={serviceMode === "DINE_IN" ? "active" : ""}
            onClick={() => setServiceMode("DINE_IN")}
          >
            Aquí
          </button>
          <button
            type="button"
            className={serviceMode === "TAKEAWAY" ? "active" : ""}
            onClick={() => setServiceMode("TAKEAWAY")}
          >
            Para llevar
          </button>
        </div>

        {savedTicket&&(
          <section className="stack" style={{gap:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"2px solid currentColor",paddingBottom:8}}>
              <strong>Pedido guardado · {money.format(savedTicket.total)}</strong>
              <span className="muted">Solo lectura</span>
            </div>
            {savedTicket.lines.map((line,index)=>(
              <div key={line.id}>
                {(index===0 || (savedTicket.lines[index-1].roundId??"INITIAL")!==(line.roundId??"INITIAL")) && (
                  <div style={{marginTop:10,marginBottom:8,paddingBottom:5,borderBottom:"1px solid currentColor"}}>
                    <strong>{historicalRoundIds.indexOf(line.roundId??"INITIAL")===0
                      ?"Primer pedido guardado"
                      :"Ronda "+(historicalRoundIds.indexOf(line.roundId??"INITIAL")+1)}</strong>
                  </div>
                )}
                <div className="pos-cart-line pos-cart-unit">
                  <div className="pos-cart-unit-main">
                    <div className="pos-cart-unit-title">
                      <strong>{index+1}. {line.quantity}× {line.name}</strong>
                      <strong>{money.format(line.unitPrice*line.quantity)}</strong>
                    </div>
                    <span className="muted">{line.serviceMode==="DINE_IN"?"Aquí · sin empaque":"Para llevar · con empaque"}</span>
                    {line.note&&<p className="muted">{line.note}</p>}
                  </div>
                </div>
              </div>
            ))}
            <div style={{borderTop:"3px solid currentColor",paddingTop:12,display:"flex",justifyContent:"space-between"}}>
              <strong>+ Productos nuevos</strong><strong>{money.format(newSubtotal)}</strong>
            </div>
          </section>
        )}
        <div className="pos-cart-lines">
          {cartLines.length === 0 ? (
            <p className="muted">{savedTicket?"Selecciona las bebidas de la nueva ronda.":"Toca un producto para agregarlo."}</p>
          ) : (
            cartLines.map((line, index) => (
              <div className="pos-cart-line pos-cart-unit" key={line.key}>
                <div className="pos-cart-unit-main">
                  <div className="pos-cart-unit-title">
                    <strong>
                      {index + 1}. {line.item.name}
                    </strong>
                    <strong>{money.format(line.item.price)}</strong>
                  </div>

                  <label style={{display:"block",marginTop:8}}>
                    Preparación
                    <select value={line.serviceMode}
                      aria-label={"Servicio de "+line.item.name}
                      onChange={event=>updateServiceMode(line.key,event.target.value as ServiceMode)}>
                      <option value="DINE_IN">Aquí · sin vaso desechable</option>
                      <option value="TAKEAWAY">Para llevar · con vaso y tapa</option>
                    </select>
                  </label>
                  <input
                    className="pos-line-note"
                    value={line.note}
                    onChange={(event) =>
                      updateNote(line.key, event.target.value)
                    }
                    placeholder="Nota: sin hielo, deslactosada, extra caliente..."
                    maxLength={180}
                    aria-label={"Nota para " + line.item.name}
                  />
                </div>

                <div className="pos-unit-actions">
                  <button
                    type="button"
                    onClick={() => duplicate(line)}
                    title="Agregar otra igual"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(line.key)}
                    title="Quitar"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pos-total">
          <span>{savedTicket?"Total del ticket (incluye lo nuevo)":"Total"}</span>
          <strong>{money.format(total)}</strong>
        </div>

        {!savedTicket&&<div className="pos-customer-box">
          <label>
            Cliente / puntos
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Sin cliente</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.pointsBalance.toFixed(2)} pts
                </option>
              ))}
            </select>
          </label>

          {selectedCustomer ? (
            <p className="muted compact-copy">
              Saldo actual:{" "}
              <strong>{selectedCustomer.pointsBalance.toFixed(2)} pts</strong>
              {" · "}
              Esta compra generaría{" "}
              <strong>{pointsPreview.toFixed(2)} pts</strong> al 5%.
            </p>
          ) : (
            <p className="muted compact-copy">
              Selecciona un cliente para calcular el 5% de puntos.
            </p>
          )}

          <details>
            <summary>+ Registrar cliente</summary>
            <form action={createPosCustomer} className="stack">
              <label>
                Nombre
                <input name="name" required minLength={2} />
              </label>
              <label>
                Teléfono
                <input name="phone" inputMode="tel" />
              </label>
              <label>
                Correo
                <input name="email" type="email" />
              </label>
              <button type="submit">Guardar cliente</button>
            </form>
          </details>
        </div>}

        <form action={savedTicket?addProductsToLiveCommand:liveEnabled?createLiveSale:createShadowSale} className="stack pos-checkout">
          {savedTicket&&<>
            <input type="hidden" name="orderId" value={savedTicket.id}/>
            <input type="hidden" name="requestId" value={additionRequestId}/>
            <input type="hidden" name="returnToPos" value="1"/>
          </>}
          {liveEnabled && <input type="hidden" name="clientOrderId" value={liveClientOrderId} />}
          <input
            type="hidden"
            name="cart"
            value={JSON.stringify(
              cartLines.map((line) => ({
                externalId: line.externalId,
                quantity: 1,
                note: line.note.trim() || null,
                serviceMode:line.serviceMode,
              })),
            )}
          />
          <input type="hidden" name="serviceMode" value={serviceMode} />
          <input type="hidden" name="customerId" value={customerId} />

          {!savedTicket && (
            <label>
              Nombre del ticket / mesa
              <input name="tableLabel" placeholder="Ej. Mesa 1, Mesa 2, Balcón 1"
                maxLength={100} autoComplete="off"/>
            </label>
          )}

          {!savedTicket&&<label>
            Método de pago
            <select
              name="paymentMethod"
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value as "CASH"|"CARD"|"TRANSFER")}
            >
              <option value="CASH" disabled={!cashOpen}>
                Efectivo{cashOpen ? "" : " · abre caja"}
              </option>
              <option value="CARD">Tarjeta</option>
              <option value="TRANSFER">Transferencia</option>
            </select>
          </label>}

          {!savedTicket&&liveEnabled && paymentMethod==="CASH" && <div className="stack">
            <label>Efectivo recibido
              <input name="tenderedAmount" type="number" inputMode="decimal" min="0" step="0.01"
                required value={tendered} onChange={(event)=>setTendered(event.target.value)}
                placeholder="Ej. 100.00" />
            </label>
            <p className="muted">Cambio a entregar:
              <strong> {Number(tendered)>=total && tendered.trim()!=="" ? money.format(Number(tendered)-total) : "Ingresa efectivo suficiente"}</strong>
            </p>
          </div>}
                    <label>
            Nota general de la mesa / orden
            <input
              name="note"
              placeholder="Ej. entregar todo junto, cumpleaños..."
              maxLength={300}
            />
          </label>

          <div className="pos-command-actions">
            {savedTicket?<>
              <button type="submit" className="pos-command-button" disabled={cartLines.length===0}>
                Guardar ticket · añadir {cartLines.length} producto(s)
              </button>
              <Link href="/pos/orders" className="button">Ir a comandas y cobrar</Link>
            </>:<>
            <button
              type="submit"
              formAction={liveEnabled ? createLiveCommand : createShadowCommand}
              formNoValidate
              className="pos-command-button"
              disabled={cartLines.length === 0}
            >
              Enviar comanda · cobrar después
            </button>
            <button
              type="submit"
              className="pos-pay-button"
              disabled={cartLines.length === 0 || (liveEnabled && paymentMethod==="CASH" && (tendered.trim()==="" || Number(tendered)<total))}
            >
              {liveEnabled ? "Cobrar ahora" : "Registrar espejo"} · {money.format(total)}
            </button>
            </>}
          </div>
        </form>

        {liveEnabled
          ? <p className="pos-shadow-warning">MODO LIVE: enviar comanda no cobra ni descuenta inventario. El cobro definitivo descuenta las recetas y registra caja y puntos. No cambies ingredientes mediante notas libres.</p>
          : <p className="pos-shadow-warning">MODO ESPEJO: comandas, puntos e inventario son simulación. Nada se descuenta ni se acredita todavía.</p>}
      </aside>
    </div>
  );
}
