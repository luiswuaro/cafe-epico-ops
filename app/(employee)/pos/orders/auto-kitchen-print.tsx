"use client";

import { useEffect, useRef, useState } from "react";
import { printKitchenSlip } from "./kitchen-print-button";
import { selectedKitchenSlip, type KitchenSlip } from "@/src/application/pos/kitchen-slip";
import {
  AUTO_KITCHEN_DINE_IN_KEY,
  AUTO_KITCHEN_TAKEAWAY_KEY,
  AUTO_KITCHEN_ATTEMPT_PREFIX,
} from "./kitchen-print-settings";

export type AutoKitchenEvent = "saved"|"paid";

export function AutoKitchenPrint({
  slip,event,eventId,
}:{
  slip:KitchenSlip;
  event:AutoKitchenEvent;
  // Identificador de operación real: orden + ronda para guardado,
  // orden + pago o ID del split para cobro. Nunca un timestamp de página.
  eventId:string;
}){
  const handled=useRef<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState(false);

  useEffect(()=>{
    const id=event+":"+eventId;
    if(handled.current===id)return;
    handled.current=id;

    const mode=event==="saved"?"DINE_IN" as const:"TAKEAWAY" as const;
    const preference=event==="saved"
      ?AUTO_KITCHEN_DINE_IN_KEY:AUTO_KITCHEN_TAKEAWAY_KEY;
    if(window.localStorage.getItem(preference)!=="1")return;

    // Filtrar únicamente la última ronda para mesas; después seleccionar el
    // tipo de servicio. Impide imprimir rondas previas si la última es otra.
    const latest=event==="saved"?selectedKitchenSlip(slip,"latest"):null;
    const eligible=(latest?.lines??slip.lines)
      .some(line=>line.serviceMode===mode);
    if(!eligible)return;

    // Reservar antes del I/O: un refresh, doble montaje de React o pestañas
    // concurrentes no deben enviar dos comandas a la misma impresora.
    const attempt=AUTO_KITCHEN_ATTEMPT_PREFIX+id;
    if(window.localStorage.getItem(attempt))return;
    window.localStorage.setItem(attempt,new Date().toISOString());

    let active=true;
    void printKitchenSlip(slip,event==="saved"?"latest":"all",mode)
      .then(printer=>{
        if(active){setError(false);setMessage("Comanda enviada automáticamente a "+printer);}
      })
      .catch(cause=>{
        if(active){
          setError(true);
          setMessage("La operación se registró, pero no se confirmó la impresión automática: "+
            (cause instanceof Error?cause.message:"sin conexión")+
            ". Usa «Imprimir comanda» para reintentar manualmente.");
        }
      });
    return ()=>{active=false;};
  },[event,eventId,slip]);

  return message?<div role={error?"alert":"status"}
    className={"card no-print "+(error?"status-warn":"status-ok")}
    style={{marginBottom:12}}>{message}</div>:null;
}
