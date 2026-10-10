"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { addProductsToLiveCommand } from "./orders/live-actions";
import {
  createPosCustomer,
  saveLiveCommand,
  createShadowCommand,
  createShadowSale,
} from "./actions";
import { submitLiveSale } from "./live-actions";

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
  canOverrideStock:boolean;
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
  canOverrideStock,
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
  const [checkoutOpen,setCheckoutOpen]=useState(false);
  const [mobileCartOpen,setMobileCartOpen]=useState(false);
  const mobileCartRef=useRef<HTMLElement>(null);
  const mobileCartCloseRef=useRef<HTMLButtonElement>(null);
  const mobileSummaryRef=useRef<HTMLButtonElement>(null);
  const [allowStockShortage,setAllowStockShortage]=useState(false);
  const [tableLabel,setTableLabel]=useState("");
  const [orderNote,setOrderNote]=useState("");
  const [checkoutState,checkoutAction,checkoutPending]=useActionState(submitLiveSale,{error:null});
  const [saveState,saveAction,savePending]=useActionState(saveLiveCommand,{error:null});

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
  const units=(savedTicket?.lines.reduce((sum,line)=>sum+line.quantity,0)??0)+cartLines.length;

  useEffect(()=>{
    if(!mobileCartOpen)return;
    const breakpoint=window.matchMedia("(max-width: 760px)");
    if(!breakpoint.matches)return;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    mobileCartCloseRef.current?.focus();
    const onResize=()=>{if(!breakpoint.matches)setMobileCartOpen(false);};
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){
        event.preventDefault();
        setMobileCartOpen(false);
      }
      if(event.key!=="Tab"||!mobileCartRef.current)return;
      const controls=Array.from(mobileCartRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      )).filter(element=>element.getClientRects().length>0);
      const first=controls[0],last=controls[controls.length-1];
      if(!first||!last)return;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    window.addEventListener("keydown",onKeyDown);
    breakpoint.addEventListener("change",onResize);
    return ()=>{
      document.body.style.overflow=oldOverflow;
      window.removeEventListener("keydown",onKeyDown);
      breakpoint.removeEventListener("change",onResize);
      mobileSummaryRef.current?.focus();
    };
  },[mobileCartOpen,checkoutOpen]);

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

  if(checkoutOpen&&liveEnabled&&!savedTicket){
    return <div className="pos-layout" style={{gridTemplateColumns:"minmax(0,1fr)"}}>
      <section className="card stack" style={{maxWidth:780,margin:"0 auto",width:"100%"}}>
        <p className="eyebrow">POS · COBRAR</p>
        <h2>Elegir método de pago</h2>
        <p className="muted">El pedido sigue en memoria hasta confirmar el cobro. Puedes volver sin perder productos ni notas.</p>
        {checkoutState.error&&<div className="status-bad" role="alert">
          No se cobró. {checkoutState.error}
        </div>}
        <div className="stack">
          {cartLines.map((line,index)=><div key={line.key} style={{display:"flex",justifyContent:"space-between",gap:12}}>
            <div>
              <strong>{index+1}. {line.item.name}</strong>
              <p className="muted">{line.serviceMode==="DINE_IN"?"Aquí":"Para llevar"}{line.note?" · "+line.note:""}</p>
            </div>
            <strong>{money.format(line.item.price)}</strong>
          </div>)}
        </div>
        <div className="pos-total"><strong>TOTAL</strong><strong>{money.format(total)}</strong></div>
        <form action={checkoutAction} className="stack">
          <input type="hidden" name="clientOrderId" value={liveClientOrderId}/>
          <input type="hidden" name="cart" value={JSON.stringify(cartLines.map(line=>({
            externalId:line.externalId,quantity:1,note:line.note.trim()||null,
            serviceMode:line.serviceMode
          })))}/>
          <input type="hidden" name="serviceMode" value={serviceMode}/>
          <input type="hidden" name="customerId" value={customerId}/>
          <input type="hidden" name="tableLabel" value={tableLabel}/>
          <input type="hidden" name="note" value={orderNote}/>
          <label>Forma de pago
            <select name="paymentMethod" value={paymentMethod}
              onChange={e=>setPaymentMethod(e.target.value as "CASH"|"CARD"|"TRANSFER")}>
              <option value="CASH" disabled={!cashOpen}>Efectivo{cashOpen?"":" · abre caja"}</option>
              <option value="CARD">Tarjeta · cobrar primero en la terminal</option>
              <option value="TRANSFER">Transferencia · confirmar depósito</option>
            </select>
          </label>
          {paymentMethod==="CASH"?<div className="stack">
            <label>Efectivo recibido
              <input name="tenderedAmount" inputMode="decimal" type="number" min={total}
                step="0.01" value={tendered} onChange={e=>setTendered(e.target.value)} required/>
            </label>
            <p className="muted">Cambio: <strong>{tendered.trim()!==""&&Number(tendered)>=total
              ?money.format(Number(tendered)-total):"Ingresa el importe recibido"}</strong></p>
          </div>:<>
            <input type="hidden" name="tenderedAmount" value=""/>
            <p className="muted">OPS registra el pago; confirma el dinero en tu banco o terminal externa.</p>
          </>}
          {canOverrideStock&&<label className="stack">
            <span><input type="checkbox" name="allowStockShortage"
              checked={allowStockShortage} onChange={e=>setAllowStockShortage(e.target.checked)}/>
              {" "}Autorizar cobro con faltante teórico (solo pedido físicamente entregado)
            </span>
            <small className="muted">Registra inventario negativo y auditoría; exige reconteo posterior. No crea existencias ficticias.</small>
          </label>}
          <button className="pos-pay-button" type="submit" disabled={checkoutPending ||
            (paymentMethod==="CASH"&&(!tendered.trim()||Number(tendered)<total))}>
            {checkoutPending?"Procesando...":"Confirmar cobro · "+money.format(total)}
          </button>
        </form>
        <button type="button" className="button" onClick={()=>setCheckoutOpen(false)}>
          ← Volver a editar pedido (sin perder notas)
        </button>
      </section>
    </div>;
  }

  return (
    <div className="pos-layout pos-layout-mobile-cart">
      <button
        ref={mobileSummaryRef}
        type="button"
        className="pos-mobile-cart-summary"
        aria-controls="pos-order-cart"
        aria-expanded={mobileCartOpen}
        aria-label={"Ver cuenta. "+units+" unidades. Total "+money.format(total)}
        onClick={()=>setMobileCartOpen(true)}
      >
        <span className="pos-mobile-summary-count" aria-hidden="true">{units}</span>
        <span className="pos-mobile-summary-label">
          <strong>{savedTicket?"Mesa · ver cuenta":"Ver cuenta"}</strong>
          <small>{units===0?"Sin productos":units+" unidad(es)"} · {savedTicket?"incluye rondas":"venta actual"}</small>
        </span>
        <strong className="pos-mobile-summary-total">{money.format(total)}</strong>
        <span className="pos-mobile-summary-chevron" aria-hidden="true">⌃</span>
      </button>
      {mobileCartOpen&&<button type="button" className="pos-mobile-cart-backdrop"
        tabIndex={-1} aria-label="Cerrar cuenta" onClick={()=>setMobileCartOpen(false)}/>}
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

      <aside id="pos-order-cart" ref={mobileCartRef}
        className={"card pos-cart"+(mobileCartOpen?" pos-cart-open":"")}
        aria-label="Detalle de la cuenta">
        <div className="pos-mobile-cart-header">
          <div>
            <span className="eyebrow">DETALLE DE LA CUENTA</span>
            <strong>{units} unidad(es) · {money.format(total)}</strong>
          </div>
          <button type="button" ref={mobileCartCloseRef}
            className="pos-mobile-cart-close" onClick={()=>setMobileCartOpen(false)}
            aria-label="Cerrar detalle y volver al catálogo">✕</button>
        </div>
        <div className="pos-cart-body">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{savedTicket?"TICKET GUARDADO":liveEnabled?"VENTA LIVE":"ORDEN ESPEJO"}</p>
            <h2>{savedTicket?.name??"Cuenta"}</h2>
            {savedTicket&&<p className="muted">{savedTicket.folio}</p>}
          </div>
          <span className="pill">{units} unidad(es)</span>
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
        {saveState.error&&<p className="status-bad" role="alert">
          Comanda no guardada: {saveState.error}. Los productos y notas siguen en el carrito.
        </p>}
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
                    placeholder="Nota para barra: 2 azúcares, sin hielo, extra caliente..."
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

        <form id="pos-order-command-form" action={savedTicket?addProductsToLiveCommand:liveEnabled?saveAction:createShadowSale} className="stack pos-checkout">
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
                maxLength={100} autoComplete="off" value={tableLabel}
                onChange={e=>setTableLabel(e.target.value)}/>
            </label>
          )}

          {!savedTicket&&!liveEnabled&&<label>
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

          {!savedTicket&&!liveEnabled && paymentMethod==="CASH" && <div className="stack">
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
              maxLength={300} value={orderNote}
              onChange={e=>setOrderNote(e.target.value)}
            />
          </label>

          <div className="pos-command-actions">
            {savedTicket?<>
              <button type="submit" className="pos-command-button" disabled={cartLines.length===0}>
                Guardar ticket · añadir {cartLines.length} producto(s)
              </button>
              {cartLines.length===0?<Link href={"/pos/checkout?ticket="+savedTicket.id}
                className="button">Cobrar ticket · {money.format(savedTicket.total)}</Link>
                :<p className="muted">Guarda estos productos nuevos antes de cobrar la mesa.</p>}
              <Link href={"/pos/orders/"+savedTicket.id+"/split"} className="button">
                Dividir cuenta
              </Link>
            </>:<>
            <button
              type="submit"
              formAction={liveEnabled ? saveAction : createShadowCommand}
              formNoValidate
              className="pos-command-button"
              disabled={cartLines.length === 0 || savePending}
            >
              Enviar comanda · cobrar después
            </button>
            <button
              type={liveEnabled?"button":"submit"}
              className="pos-pay-button"
              onClick={liveEnabled?()=>{setMobileCartOpen(false);setCheckoutOpen(true);}:undefined}
              disabled={cartLines.length===0}
            >
              {liveEnabled?"Ir a cobrar":"Registrar espejo"} · {money.format(total)}
            </button>
            </>}
          </div>
        </form>

        {liveEnabled
          ? <p className="pos-shadow-warning">Notas libres permitidas para preparación. No cambian costos ni inventario: los extras que agregan insumos requieren modificadores estructurados. El inventario se descuenta al cobrar.</p>
          : <p className="pos-shadow-warning">MODO ESPEJO: comandas, puntos e inventario son simulación. Nada se descuenta ni se acredita todavía.</p>}
        </div>
        <div className="pos-mobile-cart-footer" aria-label="Acciones de la cuenta">
          {savedTicket
            ?cartLines.length>0
              ?<button type="submit" form="pos-order-command-form" formNoValidate
                className="pos-command-button" disabled={savePending}>
                Guardar nueva ronda · {cartLines.length}
              </button>
              :<>
                <Link href={"/pos/checkout?ticket="+savedTicket.id}
                  className="button pos-mobile-footer-primary">Cobrar · {money.format(savedTicket.total)}</Link>
                <Link href={"/pos/orders/"+savedTicket.id+"/split"}
                  className="button pos-mobile-footer-secondary">Dividir cuenta</Link>
              </>
            :<>
              <button type="submit" form="pos-order-command-form" formNoValidate
                formAction={liveEnabled?saveAction:createShadowCommand}
                className="pos-command-button"
                disabled={cartLines.length===0||savePending}>
                {savePending?"Guardando…":"Guardar ticket"}
              </button>
              {liveEnabled
                ?<button type="button" className="pos-pay-button"
                  disabled={cartLines.length===0}
                  onClick={()=>{setMobileCartOpen(false);setCheckoutOpen(true);}}>
                  Cobrar · {money.format(total)}
                </button>
                :<button type="submit" form="pos-order-command-form" className="pos-pay-button"
                   disabled={cartLines.length===0}>
                   Registrar espejo
                 </button>}
            </>}
        </div>
      </aside>
    </div>
  );
}
