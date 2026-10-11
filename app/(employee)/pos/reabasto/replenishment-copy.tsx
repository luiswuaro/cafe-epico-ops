"use client";

import {useState} from "react";
export function ReplenishmentCopy({content}:{content:string}){
 const [status,setStatus]=useState("");
 return <div className="pos-replenishment-copy">
   <button type="button" className="button" onClick={async()=>{
     try{await navigator.clipboard.writeText(content);setStatus("Lista copiada.")}
     catch{setStatus("El navegador no permitió copiar; selecciona el texto de la tabla.")}
   }}>Copiar lista para compras</button>
   {status&&<small role="status" className="muted">{status}</small>}
 </div>;
}
