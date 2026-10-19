"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {getCommandBoardVersion} from "./version-actions";

export function CommandBoardAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let active=true;
    let inFlight=false;
    let lastVersion:string|null=null;
    let lastFullRefresh=0;
    let nextProbeAt=0;
    let consecutiveFailures=0;
    // El tablero conserva una red de seguridad: refresco completo cada 60 s
    // para cambios no cubiertos por la firma (p.ej. ajustes de extras).
    // Los cambios en órdenes, líneas, pagos y estados disparan actualización
    // en la próxima revisión visible de 5 segundos.
    const refreshVisible=async()=>{
      const visible=document.visibilityState==="visible";
      // navigator.onLine puede informar false aun cuando el servidor LAN responda.
      // La disponibilidad se determina consultando al OPS, sin depender de internet.
      if(!active||inFlight||!visible||Date.now()<nextProbeAt)return;
      inFlight=true;
      try{
        const version=await getCommandBoardVersion();
        if(!active)return;
        consecutiveFailures=0;
        nextProbeAt=0;
        const changed=lastVersion===null||lastVersion!==version;
        const recovery=Date.now()-lastFullRefresh>=60000;
        if(changed||recovery){
          lastVersion=version;
          lastFullRefresh=Date.now();
          router.refresh();
        }
      }catch{
        // Reintentar con backoff ante cortes de la LAN/servidor, aunque el
        // navegador declare estar offline. Un refresh de rescate cada 60 s
        // cubre cambios no incluidos en la firma sin saturar la PC.
        consecutiveFailures++;
        nextProbeAt=Date.now()+Math.min(60000,1000*2**Math.min(consecutiveFailures,6));
        if(active&&Date.now()-lastFullRefresh>=60000){
          lastFullRefresh=Date.now();
          router.refresh();
        }
      }finally{inFlight=false;}
    };
    void refreshVisible();
    const timer = window.setInterval(refreshVisible,5000);
    const wake=()=>{void refreshVisible();};
    document.addEventListener("visibilitychange",wake);
    window.addEventListener("online",wake);
    return ()=>{
      active=false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange",wake);
      window.removeEventListener("online",wake);
    };
  }, [router]);

  return null;
}
