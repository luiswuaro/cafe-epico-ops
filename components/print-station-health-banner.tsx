"use client";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
import {getPrintStationHealth} from "@/app/(employee)/pos/printer/hub-actions";

/** Alerta visible también en celulares: no depende del navegador de la impresora. */
export function PrintStationHealthBanner(){
 const pathname=usePathname();
 const enabled=pathname.startsWith("/pos")&&!pathname.startsWith("/pos/printer");
 const [health,setHealth]=useState<Awaited<ReturnType<typeof getPrintStationHealth>>|null>(null);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  if(!enabled)return;
  let active=true;
  const refresh=async()=>{
   try{
    const next=await getPrintStationHealth();
    if(active){setHealth(next);setFailed(false);}
   }catch{if(active)setFailed(true);}
  };
  void refresh();
  const timer=window.setInterval(()=>void refresh(),15000);
  const resume=()=>{if(document.visibilityState==="visible")void refresh();};
  window.addEventListener("focus",resume);
  document.addEventListener("visibilitychange",resume);
  return ()=>{active=false;window.clearInterval(timer);
   window.removeEventListener("focus",resume);
   document.removeEventListener("visibilitychange",resume);
  };
 },[enabled]);
 if(!enabled)return null;
 if(failed)return <div className="card status-warn no-print" role="alert">
  <strong>Impresión: sin señal del servidor.</strong> Verifica la comanda en barra antes de continuar.
 </div>;
 if(!health)return null;
 if(health.online&&health.bridgeReady)return null;
 return <div className="card status-warn no-print" role="alert">
  <strong>ALERTA · Impresión automática no disponible.</strong>{" "}
  {!health.online
   ?"La PC de impresión no reporta actividad reciente."
   :"La PC está conectada, pero el puente de la impresora no responde."}{" "}
  Comprueba que el pedido haya llegado a barra y revisa la estación en la PC.
  Los trabajos atrasados se retienen para revisión manual.
 </div>;
}
