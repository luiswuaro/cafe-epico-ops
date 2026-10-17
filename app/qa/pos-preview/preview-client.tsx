"use client";

import { useMemo, useState } from "react";

// Esta vista es una SIMULACIÓN sin persistencia, red, server actions ni pagos.
// No comparte ni importa el código mutador de producción.
type Group="CALIENTES"|"FRÍAS"|"ALIMENTOS";
type Entry={id:string;name:string;group:Group;price:number};
type Unit={id:number;entryId:string;account:0|1};
type CustomerId="a"|"b"|"";
type Settlement={customerId:CustomerId;points:number;cash:number;method:"CASH"|"CARD"|"TRANSFER"|"POINTS"};
const items:readonly Entry[]=[
  {id:"latte",name:"Latte",group:"CALIENTES",price:50},
  {id:"espanol",name:"Latte español",group:"CALIENTES",price:60},
  {id:"moka",name:"Moka",group:"CALIENTES",price:60},
  {id:"americano",name:"Americano",group:"CALIENTES",price:30},
  {id:"flat",name:"Flat white",group:"CALIENTES",price:35},
  {id:"latte-frio",name:"Latte frío",group:"FRÍAS",price:60},
  {id:"espanol-frio",name:"Latte español frío",group:"FRÍAS",price:70},
  {id:"moka-frio",name:"Moka frío",group:"FRÍAS",price:70},
  {id:"matcha",name:"Matcha latte frío",group:"FRÍAS",price:80},
  {id:"slush",name:"Slush de cereza",group:"FRÍAS",price:60},
  {id:"buldak",name:"Buldak con queso",group:"ALIMENTOS",price:70},
];
const byId=new Map(items.map(entry=>[entry.id,entry]));
const pesos=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
const money=(num:number)=>pesos.format(Math.round(num*100)/100);
type View="POS"|"COMANDAS"|"DIVISIÓN"|"CLIENTES";
export function OpsPosQaPreview(){
  const [view,setView]=useState<View>("POS");
  const [group,setGroup]=useState<Group>("CALIENTES");
  const [term,setTerm]=useState("");
  const [cart,setCart]=useState<Unit[]>([]);
  const [saved,setSaved]=useState<Unit[]>([]);
  const [table,setTable]=useState("Mesa 1");
  const [service,setService]=useState("DINE_IN");
  const [next,setNext]=useState(1);
  const [settlements,setSettlements]=useState<Record<number,Settlement>>({});
  const [customerPoints,setCustomerPoints]=useState<Record<"a"|"b",number>>({a:22.5,b:0});
  const [notice,setNotice]=useState("");
  const [orderStatus,setOrderStatus]=useState("RECIBIDA");
  const visible=items.filter(entry=>entry.group===group&&
    entry.name.toLocaleLowerCase("es-MX").includes(term.toLocaleLowerCase("es-MX")));
  const sum=(lines:readonly Unit[])=>lines.reduce((s,u)=>s+(byId.get(u.entryId)?.price??0),0);
  const grandTotal=sum(saved);
  const currentTotal=sum(cart);
  const paymentTotal=Object.values(settlements).reduce((s,x)=>s+x.points+x.cash,0);
  const account=(index:0|1)=>saved.filter(unit=>unit.account===index);
  const title=view==="POS"?"Tomar orden":view==="COMANDAS"?"Comandas":view==="DIVISIÓN"?"Cuentas divididas":"Clientes y puntos";
  function add(id:string){
    setCart(prev=>[...prev,{id:next,entryId:id,account:0}]);
    setNext(value=>value+1);
  }
  function save(){
    if(!cart.length)return;
    setSaved(cart.map((line,i)=>({...line,account:(i%2) as 0|1})));
    setCart([]);setSettlements({});setNotice("Comanda ficticia guardada. No se imprimió ni registró una venta.");
    setOrderStatus("RECIBIDA");setView("COMANDAS");
  }
  function reset(){
    setCart([]);setSaved([]);setSettlements({});setTable("Mesa 1");
    setNotice("La simulación volvió a cero; no se modificó ninguna base de datos.");
    setOrderStatus("RECIBIDA");setView("POS");
  }
  function settle(index:0|1,customer:CustomerId,pointsRaw:string,method:"CASH"|"CARD"|"TRANSFER"){
    const due=sum(account(index));
    const points=Number(pointsRaw);
    if(due<=0||settlements[index])return;
    if(!Number.isFinite(points)||points<0||!Number.isInteger(points*100)||
      points>due||(points>0&&!customer)||
      (customer&&points>customerPoints[customer])){
      setNotice("Canje rechazado: puntos insuficientes o importe inválido.");return;
    }
    const paid=Math.round((due-points)*100)/100;
    const earned=customer?Math.round(paid*5)/100:0;
    if(customer)setCustomerPoints(prev=>({...prev,[customer]:Math.round((prev[customer]-points+earned)*100)/100}));
    setSettlements(prev=>({...prev,[index]:{customerId:customer,points,cash:paid,method:paid===0?"POINTS":method}}));
    setNotice("Cobro de demostración registrado para Cuenta "+(index+1)+". No se hizo ningún cargo real.");
  }
  return <main className="shell pos-shell ops-preview" data-testid="qa-pos-preview">
    <section className="ops-preview-warning" role="status">
      SIMULACIÓN LOCAL QA · SIN BASE DE DATOS, PAGOS, COMANDAS NI IMPRESIÓN REALES
    </section>
    <section className="hero pos-hero">
      <div className="eyebrow">Café Épico · Ingeniería del Café · QA local</div>
      <h1>{title}</h1>
      <p className="muted">Esta pantalla es una vista de práctica. La operación real conserva la aplicación original y requiere iniciar sesión.</p>
      <div className="ops-preview-nav" aria-label="Secciones de demostración">
        {(["POS","COMANDAS","DIVISIÓN","CLIENTES"] as const).map(target=>
          <button key={target} type="button" className={view===target?"selected":""}
            onClick={()=>setView(target)}>{target}</button>)}
      </div>
    </section>
    {notice&&<div role="status" className="ops-preview-notice">{notice}</div>}
    {view==="POS"&&<div className="ops-preview-columns">
      <section className="card"><div className="eyebrow">Catálogo de muestra</div><h2>Selecciona productos</h2>
        <div className="ops-preview-nav" role="group" aria-label="Categoría">
          {(["CALIENTES","FRÍAS","ALIMENTOS"] as const).map(target=>
            <button key={target} type="button" className={group===target?"selected":""}
              onClick={()=>setGroup(target)}>{target}</button>)}
        </div>
        <input aria-label="Buscar producto" placeholder="Buscar bebida o alimento"
          value={term} onChange={event=>setTerm(event.target.value)}/>
        <div className="ops-preview-products">
          {visible.map(entry=><button type="button" key={entry.id} onClick={()=>add(entry.id)}>
            <small>{entry.group==="FRÍAS"?"16 OZ":entry.group==="CALIENTES"?"12 OZ":"ACOMPAÑAMIENTO"}</small>
            <strong>{entry.name}</strong><span>{money(entry.price)} <b>＋</b></span>
          </button>)}
        </div>
      </section>
      <aside className="card"><div className="eyebrow">Cuenta en vivo · simulada</div><h2>Venta actual</h2>
        <label>Servicio<select value={service} onChange={e=>setService(e.target.value)}>
          <option value="DINE_IN">Para aquí</option><option value="TAKEAWAY">Para llevar</option>
        </select></label>
        <label>Mesa o nombre<select value={table} onChange={e=>setTable(e.target.value)}>
          {["Mesa 1","Mesa 2","Mesa balcón 1","Para llevar 1"].map(name=><option key={name}>{name}</option>)}
        </select></label>
        <div className="ops-preview-items">
          {cart.length===0&&<p className="muted">Agrega productos para iniciar una cuenta.</p>}
          {cart.map(unit=><div key={unit.id} className="ops-preview-unit">
            <span>{byId.get(unit.entryId)?.name}</span><strong>{money(byId.get(unit.entryId)?.price??0)}</strong>
            <button type="button" aria-label="Quitar producto" onClick={()=>setCart(prev=>prev.filter(x=>x.id!==unit.id))}>−</button>
          </div>)}
        </div>
        <div className="ops-preview-total"><span>{cart.length} unidades</span><strong>{money(currentTotal)}</strong></div>
        <button type="button" className="ops-preview-primary" onClick={save} disabled={!cart.length}>Guardar comanda de prueba</button>
        <button type="button" className="ops-preview-secondary" onClick={reset}>Nueva cuenta simulada</button>
      </aside>
    </div>}
    {view==="COMANDAS"&&<section className="card"><div className="eyebrow">Flujo de mesa</div><h2>{saved.length?table:"Sin comandas"}</h2>
      {!saved.length?<p className="muted">Ve al POS, agrega productos y guarda la comanda ficticia.</p>:<>
        <p className="muted">Estado: {orderStatus} · {saved.length} productos · {money(grandTotal)}</p>
        <div className="ops-preview-items">{saved.map(x=><div className="ops-preview-unit" key={x.id}>
          <span>{byId.get(x.entryId)?.name}</span><strong>{money(byId.get(x.entryId)?.price??0)}</strong></div>)}</div>
        <div className="ops-preview-nav"><button type="button" onClick={()=>setOrderStatus("LISTA")}>Marcar lista</button>
          <button type="button" className="selected" onClick={()=>setView("DIVISIÓN")}>Dividir / cobrar</button></div>
      </>}
    </section>}
    {view==="DIVISIÓN"&&<div className="ops-preview-columns">
      <section className="card"><div className="eyebrow">Distribución de productos</div><h2>{table}</h2>
        {!saved.length?<p className="muted">Primero guarda una comanda desde el POS.</p>:saved.map(u=><div className="ops-preview-unit" key={u.id}>
          <span>{byId.get(u.entryId)?.name} · {money(byId.get(u.entryId)?.price??0)}</span>
          <select aria-label={"Cuenta para "+byId.get(u.entryId)?.name} value={u.account}
            disabled={Boolean(settlements[0]||settlements[1])}
            onChange={e=>setSaved(prev=>prev.map(x=>x.id===u.id?{...x,account:Number(e.target.value) as 0|1}:x))}>
            <option value={0}>Cuenta 1</option><option value={1}>Cuenta 2</option>
          </select></div>)}
      </section>
      <aside className="card"><div className="eyebrow">Liquidación</div><h2>Por cuenta</h2>
        {([0,1] as const).map(index=><QaSettlement key={index} index={index} total={sum(account(index))}
          settled={settlements[index]} points={customerPoints} onSettle={settle}/>)}
        <div className="ops-preview-total"><span>Abonado (incluye puntos)</span><strong>{money(paymentTotal)} / {money(grandTotal)}</strong></div>
      </aside>
    </div>}
    {view==="CLIENTES"&&<section className="card"><div className="eyebrow">Saldos ficticios</div><h2>Sin acceso a datos comerciales</h2>
      <div className="ops-preview-clients">
        <p>Cliente QA A <strong>{customerPoints.a.toFixed(2)} pts</strong></p>
        <p>Cliente QA B <strong>{customerPoints.b.toFixed(2)} pts</strong></p>
      </div>
      {Object.entries(settlements).map(([index,pay])=><p key={index} className="muted">
        Cuenta {Number(index)+1} · Cliente {pay.customerId.toUpperCase()||"SIN ASIGNAR"} ·
        {money(pay.cash+pay.points)} (puntos {money(pay.points)}, dinero {money(pay.cash)})
      </p>)}
    </section>}
    <p className="muted ops-preview-disclaimer">
      Los precios y personas de esta pantalla son ilustrativos. La simulación vive
      solamente en la memoria del navegador; recargar la página la reinicia.
      No hay API, autenticación, impresión, terminal ni base de datos conectadas.
    </p>
  </main>;
}
function QaSettlement({index,total,settled,points,onSettle}:{
  index:0|1;total:number;settled?:Settlement;points:Record<"a"|"b",number>;
  onSettle:(index:0|1,customer:CustomerId,points:string,method:"CASH"|"CARD"|"TRANSFER")=>void;
}){
  const [customer,setCustomer]=useState<CustomerId>("");
  const [redeem,setRedeem]=useState("0");
  const [method,setMethod]=useState<"CASH"|"CARD"|"TRANSFER">("TRANSFER");
  const used=Number(redeem)||0;
  const valid=used>=0&&Number.isFinite(used)&&Number.isInteger(used*100)&&
    used<=total&&(used===0||(customer!==""&&used<=points[customer]));
  const due=valid?total-used:total;
  return <div className="ops-preview-account">
    <div className="ops-preview-total"><b>Cuenta {index+1}</b><strong>{money(total)}</strong></div>
    {settled?<div className="ops-preview-notice">
      PAGADA · {settled.customerId?"Cliente QA "+settled.customerId.toUpperCase():"Sin cliente"} ·
      Puntos {money(settled.points)} + {money(settled.cash)} dinero
    </div>:<>
      <label>Cliente<select value={customer} onChange={e=>{setCustomer(e.target.value as CustomerId);setRedeem("0")}}>
        <option value="">Sin cliente</option><option value="a">Cliente QA A · {points.a.toFixed(2)} pts</option>
        <option value="b">Cliente QA B · {points.b.toFixed(2)} pts</option></select></label>
      <label>Puntos para canjear<input type="number" min="0" step="0.01" value={redeem}
        onChange={e=>setRedeem(e.target.value)}/></label>
      <label>Saldo restante<select value={method} onChange={e=>setMethod(e.target.value as typeof method)}>
        <option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option>
        <option value="CARD">Tarjeta</option></select></label>
      <p className="muted">{valid?"Restante: "+money(due):"Canje no válido: excede el saldo"}</p>
      <button type="button" className="ops-preview-primary"
        disabled={!valid||total<=0} onClick={()=>onSettle(index,customer,redeem,method)}>
        Simular cobro · Cuenta {index+1}
      </button>
    </>}
  </div>;
}
