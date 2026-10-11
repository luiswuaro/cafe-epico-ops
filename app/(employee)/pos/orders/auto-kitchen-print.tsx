"use client";

import { useEffect, useRef, useState } from "react";
import { printKitchenSlip } from "./kitchen-print-button";
import {acknowledgeKitchenPrint} from "./print-timing-actions";
import { type KitchenSlip } from "@/src/application/pos/kitchen-slip";
import {autoKitchenModes,type KitchenAutoEvent} from "@/src/domain/pos/kitchen-auto-policy";
import {
  AUTO_KITCHEN_DINE_IN_KEY,
  AUTO_KITCHEN_TAKEAWAY_KEY,
  AUTO_KITCHEN_ATTEMPT_PREFIX,
} from "./kitchen-print-settings";

export type AutoKitchenEvent = KitchenAutoEvent;

export function AutoKitchenPrint({
  slip,event,eventId,roundId,orderId,
}:{
  slip:KitchenSlip;
  event:AutoKitchenEvent;
  // Identificador de operación real: orden + ronda para guardado,
  // orden + pago o ID del split para cobro. Nunca un timestamp de página.
  eventId:string;
  roundId?:string;
  orderId?:string;
}){
  const handled=useRef<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState(false);

  useEffect(()=>{
    // Estación central evita que esta pestaña dispare la misma comanda dos veces.
    try{const hub=JSON.parse(window.localStorage.getItem("cafe-epico-print-hub-pc-v1")||"null");
      if(hub?.enabled)return;}catch{/* seguir el modo local anterior */}
    const id=event+":"+eventId;
    if(handled.current===id)return;
    handled.current=id;

    const autoDineIn=window.localStorage.getItem(AUTO_KITCHEN_DINE_IN_KEY)==="1";
    const autoTakeaway=window.localStorage.getItem(AUTO_KITCHEN_TAKEAWAY_KEY)==="1";

    // GUARDADO (aquí o para llevar): imprimir exclusivamente la nueva ronda.
    // DIRECTO: imprimir la orden nueva después de confirmar cobro.
    // PAGO POSTERIOR de una comanda guardada: no reimprimirla jamás.
    const selectedModes=autoKitchenModes(event,autoDineIn,autoTakeaway);
    if(!selectedModes.length)return;
    const eligible=slip.lines.some(line=>
      selectedModes.some(mode=>line.serviceMode===mode)&&
      (event!=="saved"||!roundId||(line.roundId||"INITIAL")===roundId)
    );
    if(!eligible)return;
    const serviceFilter=selectedModes.length===2?"BOTH":selectedModes[0];

    // Reservar antes del I/O: un refresh, doble montaje de React o pestañas
    // concurrentes no deben enviar dos comandas a la misma impresora.
    const attempt=AUTO_KITCHEN_ATTEMPT_PREFIX+id;
    if(window.localStorage.getItem(attempt))return;
    window.localStorage.setItem(attempt,new Date().toISOString());

    let active=true;
    void printKitchenSlip(slip,event==="saved"?"latest":"all",serviceFilter,roundId)
      .then(async printer=>{
        let logged=true;
        if(orderId){
          try{await acknowledgeKitchenPrint({orderId,roundId:roundId??"INITIAL",printer});}
          catch{logged=false;}
        }
        if(active){
          setError(!logged);
          setMessage(logged?"Comanda enviada automáticamente a "+printer:
            "Comanda enviada a "+printer+", pero no se pudo registrar el acuse horario.");
        }
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
  },[event,eventId,orderId,roundId,slip]);

  return message?<div role={error?"alert":"status"}
    className={"card no-print "+(error?"status-warn":"status-ok")}
    style={{marginBottom:12}}>{message}</div>:null;
}
