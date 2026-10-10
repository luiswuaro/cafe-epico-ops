"use client";
import {useEffect} from "react";
export default function GlobalError({error,reset}:{error:Error & {digest?:string};reset:()=>void}){
  useEffect(()=>{console.error("OPS_RENDER_FAILED",error);},[error]);
  return <html lang="es"><body style={{background:"#f4f0e8",color:"#1e1b18",fontFamily:"system-ui, sans-serif",margin:0}}>
    <main style={{maxWidth:460,margin:"12vh auto",padding:"20px"}}>
      <div style={{border:"1px solid #e0d8ce",borderRadius:18,padding:25,background:"#fffdfa"}}>
        <p style={{fontSize:12,fontWeight:800,letterSpacing:".14em"}}>CAFÉ ÉPICO OPS</p>
        <h1 style={{fontSize:24}}>No se pudo cargar esta pantalla</h1>
        <p>El sistema no confirmó la operación. Si intentabas cobrar o cancelar, revisa el estado del ticket antes de repetir el movimiento.</p>
        <button onClick={reset} style={{border:0,borderRadius:10,padding:"13px 18px",fontWeight:800,color:"white",background:"#201e1b",cursor:"pointer"}}>Volver a intentar</button>
        <p><a href="/pos/orders" style={{color:"#514536"}}>Ver comandas</a> · <a href="/today" style={{color:"#514536"}}>Ir a Hoy</a></p>
        {error.digest&&<small style={{color:"#897c6d"}}>Referencia: {error.digest}</small>}
      </div>
    </main>
  </body></html>;
}
