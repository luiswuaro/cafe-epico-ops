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
    // El tablero conserva una red de seguridad: refresco completo cada 60 s
    // para cambios no cubiertos por la firma (p.ej. ajustes de extras).
    // Los cambios en órdenes, líneas, pagos y estados disparan actualización
    // en la próxima revisión visible de 5 segundos.
    const refreshVisible=async()=>{
      if(!active||inFlight||document.visibilityState!=="visible"||!navigator.onLine)return;
      inFlight=true;
      try{
        const version=await getCommandBoardVersion();
        if(!active)return;
        const changed=lastVersion===null||lastVersion!==version;
        const recovery=Date.now()-lastFullRefresh>=60000;
        if(changed||recovery){
          lastVersion=version;
          lastFullRefresh=Date.now();
          router.refresh();
        }
      }catch{
        // Si falla la optimización, usar el comportamiento anterior.
        // Jamás ocultar comandas por una sonda inaccesible.
        if(active){lastFullRefresh=Date.now();router.refresh();}
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
