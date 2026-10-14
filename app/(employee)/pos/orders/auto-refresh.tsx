"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function CommandBoardAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    // El tablero sólo requiere actualizaciones mientras alguien lo consulta.
    // La estación de impresión posee un proceso separado y NO se pausa aquí.
    const refreshVisible=()=>{
      if(document.visibilityState==="visible"&&navigator.onLine)router.refresh();
    };
    const timer = window.setInterval(refreshVisible,5000);
    document.addEventListener("visibilitychange",refreshVisible);
    window.addEventListener("online",refreshVisible);
    return ()=>{
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange",refreshVisible);
      window.removeEventListener("online",refreshVisible);
    };
  }, [router]);

  return null;
}
