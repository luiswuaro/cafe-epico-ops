"use client";

import { useEffect, useRef, useState } from "react";
import { printKitchenSlip } from "./kitchen-print-button";
import { type KitchenSlip } from "@/src/application/pos/kitchen-slip";
import {
  AUTO_KITCHEN_DINE_IN_KEY,
  AUTO_KITCHEN_TAKEAWAY_KEY,
  AUTO_KITCHEN_ATTEMPT_PREFIX,
} from "./kitchen-print-settings";

export type AutoKitchenEvent = "saved"|"paid"|"paid-direct";

export function AutoKitchenPrint({
  slip,event,eventId,roundId,
}:{
  slip:KitchenSlip;
  event:AutoKitchenEvent;
  // Identificador de operación real: orden + ronda para guardado,
  // orden + pago o ID del split para cobro. Nunca un timestamp de página.
  eventId:string;
  roundId?:string;
}){
  const handled=useRef<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState(false);

  useEffect(()=>{
    const id=event+":"+eventId;
    if(handled.current===id)return;
    handled.current=id;

    const autoDineIn=window.localStorage.getItem(AUTO_KITCHEN_DINE_IN_KEY)==="1";
    const autoTakeaway=window.localStorage.getItem(AUTO_KITCHEN_TAKEAWAY_KEY)==="1";

    // Mesa guardada: sólo AQUÍ y sólo la ronda recién guardada.
    // Mesa ya guardada cobrada: sólo PARA LLEVAR (AQUÍ ya se envió).
    // Cobro directo: ambos servicios son nuevos; respetar ambos ON/OFF y
    // enviarlos en una sola comanda cuando las dos opciones estén activas.
    const selectedModes:Array<"DINE_IN"|"TAKEAWAY">=event==="saved"
      ?(autoDineIn?["DINE_IN"]:[])
      :event==="paid"?(autoTakeaway?["TAKEAWAY"]:[])
      :[
        ...(autoDineIn?["DINE_IN" as const]:[]),
        ...(autoTakeaway?["TAKEAWAY" as const]:[]),
      ];
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
  },[event,eventId,roundId,slip]);

  return message?<div role={error?"alert":"status"}
    className={"card no-print "+(error?"status-warn":"status-ok")}
    style={{marginBottom:12}}>{message}</div>:null;
}
