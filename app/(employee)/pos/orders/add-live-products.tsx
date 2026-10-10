"use client";

import { useMemo, useState } from "react";
import { addProductsToLiveCommand } from "./live-actions";

type Product={id:string;name:string;category:string;price:number};

export function AddLiveProducts({orderId,products}:{
  orderId:string;products:Product[];
}){
  const [selection,setSelection]=useState("");
  const [quantity,setQuantity]=useState(1);
  const [espressoShots,setEspressoShots]=useState(0);
  const [cart,setCart]=useState<Array<{externalId:string;quantity:number;extras?:Array<{id:"ESPRESSO_SHOT";quantity:number}>}>>([]);
  const [requestId]=useState(()=>crypto.randomUUID());
  const byId=useMemo(()=>new Map(products.map(p=>[p.id,p])),[products]);
  const amount=cart.reduce((sum,line)=>sum+((byId.get(line.externalId)?.price??0)+(line.extras?.[0]?.quantity??0)*10)*line.quantity,0);
  const formatted=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
  return <details className="pos-cancel-panel">
    <summary>+ Agregar otra ronda a la mesa</summary>
    <div className="stack" style={{paddingTop:12}}>
      <p className="muted">Añade productos a esta comanda sin cobrar todavía. Los nuevos productos se enviarán a preparación.</p>
      <label>Producto
        <select value={selection} onChange={e=>{setSelection(e.target.value);setEspressoShots(0);}}>
          <option value="">Seleccionar bebida o alimento</option>
          {products.map(p=><option key={p.id} value={p.id}>{p.name} · {formatted.format(p.price)}</option>)}
        </select>
      </label>
      <label>Cantidad
        <input type="number" min={1} max={20} step={1} value={quantity} onChange={e=>setQuantity(Math.max(1,Math.min(20,Number(e.target.value)||1)))} />
      </label>
      {selection&&byId.get(selection)?.category!=="ALIMENTOS"&&<label>Espressos extra por bebida · +$10.00 c/u
        <select value={espressoShots} onChange={e=>setEspressoShots(Number(e.target.value))}>
          <option value={0}>Sin extra</option>
          <option value={1}>+1 espresso · $10.00</option>
          <option value={2}>+2 espressos · $20.00</option>
        </select>
      </label>}
      <button type="button" className="button" disabled={!selection||cart.length>=30} onClick={()=>{
        if(!selection)return;
        setCart(old=>[...old,{externalId:selection,quantity,
          extras:espressoShots?[{id:"ESPRESSO_SHOT",quantity:espressoShots}]:[]}]);
        setSelection("");setQuantity(1);setEspressoShots(0);
      }}>+ Añadir al pedido</button>
      {cart.length>0&&<div className="stack compact-stack">
        {cart.map((line,index)=><div className="row" key={index} style={{display:"flex",gap:8,justifyContent:"space-between",alignItems:"center"}}>
          <span>{line.quantity}× {byId.get(line.externalId)?.name??"Producto"}
            {(line.extras?.[0]?.quantity??0)>0?" · +"+line.extras![0].quantity+" espresso(s) extra c/u":""}
            {" · "}{formatted.format(((byId.get(line.externalId)?.price??0)+(line.extras?.[0]?.quantity??0)*10)*line.quantity)}
          </span>
          <button type="button" onClick={()=>setCart(old=>old.filter((_,i)=>i!==index))}>Quitar</button>
        </div>)}
        <strong>Subtotal adicional: {formatted.format(amount)}</strong>
      </div>}
      <form action={addProductsToLiveCommand} className="stack">
        <input type="hidden" name="orderId" value={orderId}/>
        <input type="hidden" name="requestId" value={requestId}/>
        <input type="hidden" name="cart" value={JSON.stringify(cart)}/>
        <button type="submit" disabled={!cart.length}>Enviar nueva ronda · {formatted.format(amount)}</button>
      </form>
    </div>
  </details>;
}
