"use client";

import {useEffect,useState} from "react";
import {durationText,durationSeconds} from "@/src/domain/pos/command-timing";

/** Cronómetro vivo. No inventa impresión cuando el puente no dio acuse. */
export function CommandTimer({createdAt,roundStartedAt,printAckAt,preparingAt,readyAt,
  dispatchedAt,serviceMode,hasTakeaway,status}:{createdAt:string;roundStartedAt:string;
    hasTakeaway:boolean;
    dispatchedAt:string|null;
    printAckAt:string|null;preparingAt:string|null;readyAt:string|null;
    serviceMode:string;status:string;
  }){
  const [now,setNow]=useState<number|null>(null);
  useEffect(()=>{
    const refresh=()=>setNow(Date.now());
    refresh();
    const timer=window.setInterval(refresh,1000);
    return ()=>window.clearInterval(timer);
  },[]);
  const since=(start:string,end:string|null)=>
    durationText(durationSeconds(new Date(start),
      end?new Date(end):new Date(now??new Date(start).getTime())));
  const queueSeconds=now===null?0:durationSeconds(new Date(roundStartedAt),new Date(now));
  const level=queueSeconds>=900?"late":queueSeconds>=480?"attention":"ok";
  return <div className={"command-live-timing command-live-timing-"+level} aria-label="Tiempo de servicio">
    <span><strong>Pedido:</strong> {now===null?"—":since(roundStartedAt,null)}</span>
    <span><strong>Preparación total:</strong> {printAckAt
      ?(readyAt?"Impresión → listo · "+since(printAckAt,readyAt)
        :now===null?"—":"Desde impresión · "+since(printAckAt,null))
      : "Sin acuse de impresión"}</span>
    {preparingAt&&<span><strong>Preparando (marcaje manual):</strong> {readyAt
      ?since(preparingAt,readyAt):now===null?"—":since(preparingAt,null)}</span>}
    {readyAt&&!preparingAt&&<small>Lista directamente · preparación finalizada.</small>}
    {hasTakeaway&&<span>
      <strong>Despacho:</strong> {dispatchedAt
        ?"Entregado · "+since(roundStartedAt,dispatchedAt)
        :readyAt?(now===null?"Listo para entregar":"Listo hace "+since(readyAt,null))
        :"En preparación"}
    </span>}
    {serviceMode==="DINE_IN"&&<span>
      <strong>Mesa:</strong> {now===null?"—":since(createdAt,null)}
    </span>}
    {status==="READY"&&!readyAt&&<small>Esta comanda no tiene marca histórica de «Lista».</small>}
  </div>;
}
