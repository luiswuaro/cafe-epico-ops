"use client";

import {useMemo,useState} from "react";
import {addProductsToLiveCommand} from "./live-actions";
import type {ExtraOption} from "@/src/application/pos/extra-catalog";

type Product={id:string;name:string;category:string;price:number};
type Selection={id:string;quantity:number};
type Line={externalId:string;quantity:number;extras:Selection[]};

export function AddLiveProducts({orderId,products,extrasOptions}:{
  orderId:string;products:Product[];extrasOptions:ExtraOption[];
}){
  const [selection,setSelection]=useState("");
  const [quantity,setQuantity]=useState(1);
  const [selectedExtras,setSelectedExtras]=useState<Selection[]>([]);
  const [cart,setCart]=useState<Line[]>([]);
  const [requestId]=useState(()=>crypto.randomUUID());
  const byId=useMemo(()=>new Map(products.map(p=>[p.id,p])),[products]);
  const byExtra=useMemo(()=>new Map(extrasOptions.map(x=>[x.id,x])),[extrasOptions]);
  const formatted=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
  const extrasAmount=(extras:Selection[])=>extras.reduce((sum,e)=>
    sum+(byExtra.get(e.id)?.price??0)*e.quantity,0);
  const amount=cart.reduce((sum,line)=>
    sum+((byId.get(line.externalId)?.price??0)+extrasAmount(line.extras))*line.quantity,0);
  const setExtra=(id:string,count:number)=>{
    setSelectedExtras(items=>{
      const others=items.filter(item=>item.id!==id);
      return count>0?[...others,{id,quantity:count}]:others;
    });
  };
  return <details className="pos-cancel-panel">
    <summary>+ Agregar otra ronda a la mesa</summary>
    <div className="stack" style={{paddingTop:12}}>
      <p className="muted">Añade productos sin cobrar todavía. Los extras quedan asociados a cada bebida.</p>
      <label>Producto
        <select value={selection} onChange={e=>{setSelection(e.target.value);setSelectedExtras([]);}}>
          <option value="">Seleccionar bebida o alimento</option>
          {products.map(p=><option key={p.id} value={p.id}>{p.name} · {formatted.format(p.price)}</option>)}
        </select>
      </label>
      <label>Cantidad
        <input type="number" min={1} max={20} step={1} value={quantity}
          onChange={e=>setQuantity(Math.max(1,Math.min(20,Number(e.target.value)||1)))} />
      </label>
      {selection&&byId.get(selection)?.category!=="ALIMENTOS"&&
        <details className="pos-cancel-panel" style={{padding:10}}>
          <summary style={{cursor:"pointer",fontWeight:700}}>
            + Extras {selectedExtras.length>0?
              " · "+selectedExtras.reduce((sum,e)=>sum+e.quantity,0)+
              " seleccionados · +"+formatted.format(extrasAmount(selectedExtras)):""}
          </summary>
          <div className="stack" style={{paddingTop:10,gap:8}}>
            {extrasOptions.length===0&&<small className="muted">Sin extras configurados.</small>}
            {extrasOptions.map(option=><label key={option.id}
              style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <span>{option.label} · <strong>+{formatted.format(option.price)}</strong>
                {!option.enabled&&<small className="muted" style={{display:"block"}}>{option.reason}</small>}
              </span>
              <select disabled={!option.enabled}
                value={selectedExtras.find(e=>e.id===option.id)?.quantity??0}
                onChange={e=>setExtra(option.id,Number(e.target.value))}
                aria-label={option.label+" de la nueva ronda"}>
                {Array.from({length:option.maxQuantity+1},(_,n)=>
                  <option value={n} key={n}>{n}</option>)}
              </select>
            </label>)}
          </div>
        </details>}
      <button type="button" className="button" disabled={!selection||cart.length>=30} onClick={()=>{
        if(!selection)return;
        setCart(old=>[...old,{externalId:selection,quantity,extras:selectedExtras.map(x=>({...x}))}]);
        setSelection("");setQuantity(1);setSelectedExtras([]);
      }}>+ Añadir al pedido</button>
      {cart.length>0&&<div className="stack compact-stack">
        {cart.map((line,index)=><div className="row" key={index}
          style={{display:"flex",gap:8,justifyContent:"space-between",alignItems:"center"}}>
          <span>{line.quantity}× {byId.get(line.externalId)?.name??"Producto"}
            {line.extras.map(extra=>" · +"+extra.quantity+" "+(byExtra.get(extra.id)?.label??"extra"))}
            {" · "}{formatted.format(((byId.get(line.externalId)?.price??0)+extrasAmount(line.extras))*line.quantity)}
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
