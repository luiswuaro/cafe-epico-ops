"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { addProductsToLiveCommand } from "./orders/live-actions";
import {
  createPosCustomer,
  saveLiveCommand,
  submitShadowSale,
  submitShadowCommand,
} from "./actions";
import { submitLiveSale } from "./live-actions";
import type {ExtraOption} from "@/src/application/pos/extra-catalog";
import {OWN_CONTAINER_DISCOUNT_MXN,canUseOwnContainer,ownContainerUnitPrice} from "@/src/domain/pos/own-container";
import {
  DINE_IN_TICKET_PRESETS,TAKEAWAY_TICKET_PRESETS,
  effectiveOrderServiceMode,
} from "@/src/application/pos/ticket-names";

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
  key:string;externalId:string;note:string;serviceMode:ServiceMode;customerContainer:boolean;extras:Array<{id:string;quantity:number}>;
};
type SavedTicket={
  id:string;folio:string;name:string;total:number;customerId:string|null;
  status:string;serviceMode:ServiceMode;
  lines:Array<{id:string;name:string;quantity:number;note:string|null;unitPrice:number;serviceMode:ServiceMode;isAdditionalRound:boolean;roundId:string|null;extrasLabel:string|null}>;
};

type Props = {
  catalog: CatalogItem[];
  extrasOptions:ExtraOption[];
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
  extrasOptions,
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
  const [ticketNameOption,setTicketNameOption]=useState("");
  const [customTicketName,setCustomTicketName]=useState("");
  const [orderNote,setOrderNote]=useState("");
  const [checkoutState,checkoutAction,checkoutPending]=useActionState(submitLiveSale,{error:null});
  const [saveState,saveAction,savePending]=useActionState(saveLiveCommand,{error:null});
  const [shadowState,shadowAction]=useActionState(submitShadowSale,{error:null});
  const [shadowSaveState,shadowSaveAction,shadowSavePending]=useActionState(submitShadowCommand,{error:null});

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
  const extraById=new Map(extrasOptions.map(option=>[option.id,option]));
  const extraCharge=(line:CartLine)=>line.extras.reduce((sum,e)=>
    sum+(extraById.get(e.id)?.price??0)*e.quantity,0);
  const unitPrice=(line:typeof cartLines[number])=>ownContainerUnitPrice(line.item.price,extraCharge(line),line.customerContainer);
  const newSubtotal=cartLines.reduce((sum,line)=>sum+unitPrice(line),0);
  const total=(savedTicket?.total??0)+newSubtotal;
  const units=(savedTicket?.lines.reduce((sum,line)=>sum+line.quantity,0)??0)+cartLines.length;
  const ticketServiceMode=cartLines.length
    ?effectiveOrderServiceMode(serviceMode,cartLines):serviceMode;
  const namePresets=ticketServiceMode==="DINE_IN"
    ?DINE_IN_TICKET_PRESETS:TAKEAWAY_TICKET_PRESETS;
  const displayTicketNameOption=ticketNameOption==="CUSTOM" ||
    (ticketServiceMode==="TAKEAWAY"&&ticketNameOption==="AUTO") ||
    namePresets.some(option=>option===ticketNameOption)
      ?ticketNameOption:ticketServiceMode==="TAKEAWAY"?"AUTO":"";
  const tableLabel=displayTicketNameOption==="CUSTOM"
    ?customTicketName.trim()
    :displayTicketNameOption==="AUTO"?"":displayTicketNameOption;
  const missingTable=!savedTicket&&ticketServiceMode==="DINE_IN"&&!tableLabel;
  const ticketNamePreview=tableLabel||
    (ticketServiceMode==="DINE_IN"?"Mesa obligatoria":"Folio automático de hoy");

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
        serviceMode,customerContainer:false,extras:[],
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
        serviceMode:line.serviceMode,customerContainer:line.customerContainer,extras:line.extras.map(e=>({...e})),
      },
    ]);
  }

  function updateServiceMode(key:string,next:ServiceMode){
    setCart(current=>current.map(line=>line.key===key?{...line,serviceMode:next,customerContainer:next==="TAKEAWAY"&&line.customerContainer}:line));
    // Ante un cambio a modo mixto, el selector se recalcula automáticamente.
  }

  function changeDefaultService(next:ServiceMode){
    setServiceMode(next);
    // El botón Aquí/Para llevar es para toda la cuenta; las líneas
    // pueden corregirse por separado después.
    setCart(current=>current.map(line=>({...line,serviceMode:next,customerContainer:next==="TAKEAWAY"&&line.customerContainer})));
    setTicketNameOption(next==="TAKEAWAY"?"AUTO":"");
    setCustomTicketName("");
  }

  function updateOwnContainer(key:string,enabled:boolean){
    setCart(current=>current.map(line=>{
      if(line.key!==key)return line;
      const item=catalogById.get(line.externalId);
      return {...line,customerContainer:Boolean(enabled&&item&&canUseOwnContainer(item,line.serviceMode))};
    }));
  }

  function updateExtraQuantity(key:string,id:string,quantity:number){
    setCart(current=>current.map(line=>{
      if(line.key!==key)return line;
      const without=line.extras.filter(extra=>extra.id!==id);
      return {...line,extras:quantity>0?[...without,{id,quantity}]:without};
    }));
  }

  function updateNote(key: string, note: string) {
    setCart((current) =>
      current.map((line) => (line.key === key ? { ...line, note } : line)),
    );
  }

  if(checkoutOpen&&!liveEnabled&&!savedTicket){
    const cashPaid=tendered.trim()!==""?Number(tendered):NaN;
    const cashSufficient=Number.isFinite(cashPaid)&&cashPaid>=total;
    const cashChange=cashSufficient
      ?Math.round((cashPaid-total+Number.EPSILON)*100)/100:0;
    return <div className="pos-layout" style={{gridTemplateColumns:"minmax(0,1fr)"}}>
      <section className="card stack" style={{maxWidth:780,margin:"0 auto",width:"100%"}}>
        <p className="eyebrow">POS · PREVIEW · SIMULACIÓN SEGURA</p>
        <h2>Probar cobro sin registrar venta</h2>
        <p className="status-warn" role="status">
          Este preview está en modo espejo. El simulador NO cobra, no crea tickets,
          no registra ventas, no modifica caja ni descuenta inventario.
        </p>
        <p className="muted">Pedido: <strong>{ticketNamePreview}</strong>
          {" · "}{ticketServiceMode==="TAKEAWAY"?"Para llevar":"Aquí"}
        </p>
        <div className="stack">
          {cartLines.map((line,index)=><div key={line.key} className="pos-cart-line"
            style={{display:"flex",justifyContent:"space-between",gap:12}}>
            <div>
              <strong>{index+1}. {line.item.name}</strong>
              <p className="muted" style={{margin:0}}>
                {line.customerContainer
                  ?"Termo propio · descuento de "+money.format(OWN_CONTAINER_DISCOUNT_MXN)+" · sin desechables"
                  :line.serviceMode==="TAKEAWAY"?"Para llevar · con empaque":"Aquí"}
              </p>
              {line.extras.length>0&&<small className="muted">
                Extras · +{money.format(extraCharge(line))}
              </small>}
            </div>
            <strong>{money.format(unitPrice(line))}</strong>
          </div>)}
        </div>
        <div className="pos-total"><strong>TOTAL SIMULADO</strong>
          <strong>{money.format(total)}</strong></div>
        <label>Método de pago (simulado)
          <select value={paymentMethod}
            onChange={e=>setPaymentMethod(e.target.value as "CASH"|"CARD"|"TRANSFER")}>
            <option value="CASH">Efectivo</option>
            <option value="CARD">Tarjeta</option>
            <option value="TRANSFER">Transferencia</option>
          </select>
        </label>
        {paymentMethod==="CASH"&&<div className="stack">
          <label>Importe recibido (simulado)
            <input type="number" min="0" step=".01" inputMode="decimal"
              value={tendered} onChange={e=>setTendered(e.target.value)}
              placeholder="Ej. 100"/>
          </label>
          <p className={cashSufficient?"status-ok":"status-warn"} role="status">
            {cashSufficient
              ?"Cambio a entregar: "+money.format(cashChange)
              :"Ingresa una cantidad al menos igual al total para calcular el cambio."}
          </p>
        </div>}
        <p className="muted">El descuento y la receta se calculan en el servidor cuando
          el cobro LIVE está habilitado. Esta pantalla es una prueba visual;
          no confirma una transacción real.</p>
        <button type="button" className="button" onClick={()=>setCheckoutOpen(false)}>
          ← Volver a editar el pedido
        </button>
      </section>
    </div>;
  }

  if(checkoutOpen&&liveEnabled&&!savedTicket){
    return <div className="pos-layout" style={{gridTemplateColumns:"minmax(0,1fr)"}}>
      <section className="card stack" style={{maxWidth:780,margin:"0 auto",width:"100%"}}>
        <p className="eyebrow">POS · COBRAR</p>
        <h2>Elegir método de pago</h2>
        <p className="muted">Ticket: <strong>{ticketNamePreview}</strong> · {ticketServiceMode==="DINE_IN"?"Aquí":"Para llevar"}</p>
        <p className="muted">El pedido sigue en memoria hasta confirmar el cobro. Puedes volver sin perder productos ni notas.</p>
        {checkoutState.error&&<div className="status-bad" role="alert">
          No se cobró. {checkoutState.error}
        </div>}
        <div className="stack">
          {cartLines.map((line,index)=><div key={line.key} style={{display:"flex",justifyContent:"space-between",gap:12}}>
            <div>
              <strong>{index+1}. {line.item.name}</strong>
              <p className="muted">{line.serviceMode==="DINE_IN"?"Aquí":line.customerContainer?"Para llevar · termo propio (-$5)":"Para llevar"}{line.note?" · "+line.note:""}</p>
            </div>
            <div style={{textAlign:"right"}}>
              <strong>{money.format(unitPrice(line))}</strong>
              {line.extras.length>0&&<small className="muted" style={{display:"block"}}>
                Extras · +{money.format(extraCharge(line))}
              </small>}
            </div>
          </div>)}
        </div>
        <div className="pos-total"><strong>TOTAL</strong><strong>{money.format(total)}</strong></div>
        <form action={checkoutAction} className="stack">
          <input type="hidden" name="clientOrderId" value={liveClientOrderId}/>
          <input type="hidden" name="cart" value={JSON.stringify(cartLines.map(line=>({
            externalId:line.externalId,quantity:1,note:line.note.trim()||null,
            serviceMode:line.serviceMode,customerContainer:line.customerContainer,
            extras:line.extras
          })))}/>
          <input type="hidden" name="serviceMode" value={ticketServiceMode}/>
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
            missingTable || (paymentMethod==="CASH"&&(!tendered.trim()||Number(tendered)<total))}>
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

        <p className="muted" style={{marginBottom:0}}>Elige el servicio para esta cuenta. Puedes ajustarlo por bebida si el pedido es mixto.</p>
        <div className="pos-service-toggle">
          <button
            type="button"
            className={serviceMode === "DINE_IN" ? "active" : ""}
            onClick={() => changeDefaultService("DINE_IN")}
          >
            Aquí
          </button>
          <button
            type="button"
            className={serviceMode === "TAKEAWAY" ? "active" : ""}
            onClick={() => changeDefaultService("TAKEAWAY")}
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
                    {line.extrasLabel&&<p className="muted">{line.extrasLabel}</p>}
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
        {(saveState.error||shadowSaveState.error||shadowState.error)&&<p className="status-bad" role="alert">
          {saveState.error||shadowSaveState.error||shadowState.error}
          {" "}Los productos y notas siguen en el carrito.
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
                    <strong>{money.format(unitPrice(line))}</strong>
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
                  {canUseOwnContainer(line.item,line.serviceMode)&&<label className="pos-own-thermos-control">
                    <input type="checkbox" checked={line.customerContainer}
                      onChange={event=>updateOwnContainer(line.key,event.target.checked)}
                      aria-label={"Termo propio, descuento de 5 pesos para "+line.item.name}/>
                    <span>
                      <strong>Termo propio · −{money.format(OWN_CONTAINER_DISCOUNT_MXN)}</strong>
                      <small>Para llevar sin vaso, tapa, popote ni desechables</small>
                    </span>
                  </label>}
                  {line.item.category!=="ALIMENTOS"&&<details
                    className="pos-cancel-panel" style={{marginTop:8,padding:"6px 10px"}}>
                    <summary style={{cursor:"pointer",fontWeight:700}}>
                      + Extras {line.extras.length>0?" · "+line.extras.reduce((n,e)=>n+e.quantity,0)+" seleccionado(s) · +"+money.format(extraCharge(line)):""}
                    </summary>
                    <div className="stack" style={{paddingTop:10,gap:8}}>
                      {extrasOptions.length===0&&<small className="muted">Sin extras configurados.</small>}
                      {extrasOptions.map(option=>{
                        const qty=line.extras.find(e=>e.id===option.id)?.quantity??0;
                        return <label key={option.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                          <span>{option.label} · <strong>+{money.format(option.price)}</strong>
                            {!option.enabled&&<small className="muted" style={{display:"block"}}>{option.reason}</small>}
                          </span>
                          <select aria-label={option.label+" para "+line.item.name}
                            disabled={!option.enabled} value={qty}
                            onChange={event=>updateExtraQuantity(line.key,option.id,Number(event.target.value))}>
                            {Array.from({length:option.maxQuantity+1},(_,n)=><option key={n} value={n}>{n}</option>)}
                          </select>
                        </label>;
                      })}
                    </div>
                  </details>}
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

        {!savedTicket&&<section className="pos-customer-box" aria-labelledby="pos-customer-heading">
          <div className="pos-customer-heading">
            <span className="pos-customer-icon" aria-hidden="true">◎</span>
            <div>
              <h3 id="pos-customer-heading">Cliente y puntos</h3>
              <p>Programa de lealtad · 5% de cada compra</p>
            </div>
          </div>
          <label className="pos-customer-selector">
            Identificar cliente
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Sin cliente · venta normal</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.pointsBalance.toFixed(2)} pts
                </option>
              ))}
            </select>
          </label>
          {selectedCustomer ? (
            <div className="pos-customer-points" aria-live="polite">
              <div><span>Saldo disponible</span><strong>{selectedCustomer.pointsBalance.toFixed(2)} pts</strong></div>
              <div><span>Ganará con esta compra</span><strong>+{pointsPreview.toFixed(2)} pts</strong></div>
            </div>
          ) : (
            <p className="pos-customer-help">Opcional. Puedes continuar sin cliente o registrarlo aquí.</p>
          )}
          <details className="pos-customer-registration">
            <summary><span aria-hidden="true">＋</span> Registrar cliente nuevo</summary>
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
        </section>}

        <form id="pos-order-command-form" action={savedTicket?addProductsToLiveCommand:liveEnabled?saveAction:shadowAction} className="stack pos-checkout">
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
                serviceMode:line.serviceMode,customerContainer:line.customerContainer,
                extras:line.extras,
              })),
            )}
          />
          <input type="hidden" name="serviceMode" value={ticketServiceMode} />
          <input type="hidden" name="customerId" value={customerId} />

          {!savedTicket && (
            <details className="pos-cancel-panel" style={{padding:"8px 12px"}}>
              <summary style={{cursor:"pointer",fontWeight:700}}>
                {ticketServiceMode==="DINE_IN"?"Mesa / nombre de ticket":"Nombre para llevar"}
                {" · "}{ticketNamePreview}
              </summary>
              <div className="stack" style={{paddingTop:10}}>
                <small className="muted">
                  {ticketServiceMode==="DINE_IN"
                    ?"Obligatorio para consumir aquí. Elige una mesa o escribe un nombre."
                    :"Opcional: si lo dejas automático, OPS asigna el número de orden del día al guardar o cobrar."}
                </small>
                <label>Identificar pedido
                  <select aria-label="Mesa o nombre del ticket"
                    value={displayTicketNameOption}
                    onChange={event=>setTicketNameOption(event.target.value)}>
                    {ticketServiceMode==="DINE_IN"
                      ?<option value="">Selecciona una mesa…</option>
                      :<option value="AUTO">Número de orden de hoy · automático</option>}
                    {namePresets.map(name=><option key={name} value={name}>{name}</option>)}
                    <option value="CUSTOM">Nombre personalizado…</option>
                  </select>
                </label>
                {displayTicketNameOption==="CUSTOM"&&<label>Nombre personalizado
                  <input type="text" maxLength={100} autoComplete="off"
                    placeholder={ticketServiceMode==="DINE_IN"?"Ej. Mesa de cumpleaños":"Ej. Juan, pedido de María"}
                    value={customTicketName} onChange={event=>setCustomTicketName(event.target.value)}/>
                </label>}
              </div>
            </details>
          )}
          {!savedTicket&&<input type="hidden" name="tableLabel" value={tableLabel}/>}
          {missingTable&&<p role="alert" className="status-warn">
            Elige la mesa en «Mesa / nombre de ticket» para poder guardar o cobrar.
          </p>}

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
              <button type="submit" className="pos-command-button" disabled={cartLines.length===0||missingTable}>
                Guardar ticket · añadir {cartLines.length} producto(s)
              </button>
              {cartLines.length===0?<Link href={"/pos/checkout?ticket="+savedTicket.id}
                className="button">Cobrar ticket · {money.format(savedTicket.total)}</Link>
                :<p className="muted">Guarda estos productos nuevos antes de cobrar la mesa.</p>}
              <Link href={"/pos/orders/"+savedTicket.id+"/prebill"} className="button pos-prebill-link">
                Ver o imprimir precuenta de mesa
              </Link>
              <Link href={"/pos/orders/"+savedTicket.id+"/split"} className="button">
                Dividir cuenta
              </Link>
            </>:<>
            <button
              type="submit"
              formAction={liveEnabled ? saveAction : shadowSaveAction}
              formNoValidate
              className="pos-command-button"
              disabled={cartLines.length === 0 || savePending || missingTable}
            >
              Enviar comanda · cobrar después
            </button>
            <button
              type="button"
              className="pos-pay-button"
              onClick={()=>{setMobileCartOpen(false);setCheckoutOpen(true);}}
              disabled={cartLines.length===0||missingTable}
            >
              {liveEnabled?"Ir a cobrar":"Simular cobro"} · {money.format(total)}
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
                <Link href={"/pos/orders/"+savedTicket.id+"/prebill"}
                  className="button pos-mobile-footer-prebill">Imprimir precuenta</Link>
              </>
            :<>
              <button type="submit" form="pos-order-command-form" formNoValidate
                formAction={liveEnabled?saveAction:shadowSaveAction}
                className="pos-command-button"
                disabled={cartLines.length===0||savePending||shadowSavePending||missingTable}>
                {savePending?"Guardando…":"Guardar ticket"}
              </button>
              <button type="button" className="pos-pay-button"
                disabled={cartLines.length===0||missingTable}
                onClick={()=>{setMobileCartOpen(false);setCheckoutOpen(true);}}>
                {liveEnabled?"Cobrar":"Simular cobro"} · {money.format(total)}
              </button>
            </>}
        </div>
      </aside>
    </div>
  );
}
