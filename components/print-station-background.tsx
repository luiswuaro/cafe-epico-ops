"use client";
import {useEffect,useState} from "react";
import {PrintStation} from "@/app/(employee)/pos/printer/print-station";
import {getPrintStationTemplate} from "@/app/(employee)/pos/printer/hub-actions";
import type {DirectReceiptTemplate} from "@/app/(employee)/pos/receipt/[id]/direct-print-button";
const KEY="cafe-epico-print-hub-pc-v1";
/** Un solo worker por pestaña OPS, sin ventana exclusiva. */
export function PrintStationBackground(){
 const [enabled,setEnabled]=useState(false);
 const [template,setTemplate]=useState<DirectReceiptTemplate|null>(null);
 useEffect(()=>{
  const sync=()=>{
   try{const config=JSON.parse(window.localStorage.getItem(KEY)||"null") as {enabled?:boolean}|null;
    setEnabled(config?.enabled===true);
    if(config?.enabled!==true)setTemplate(null);
   }catch{setEnabled(false);setTemplate(null)}
  };
  const frame=window.requestAnimationFrame(sync);
  window.addEventListener("storage",sync);
  window.addEventListener("ops-print-hub-config-changed",sync);
  return ()=>{window.cancelAnimationFrame(frame);
   window.removeEventListener("storage",sync);
   window.removeEventListener("ops-print-hub-config-changed",sync);
  };
 },[]);
 useEffect(()=>{
  if(!enabled)return;
  let alive=true;
  let loading=false;
  let ready=false;
  let retryTimer:number|null=null;
  let retryDelay=10000;
  const loadTemplate=async()=>{
    if(!alive||loading||ready)return;
    loading=true;
    try{
      const settings=await getPrintStationTemplate();
      if(!alive)return;
      ready=true;
      retryDelay=10000;
      setTemplate(settings);
    }catch{
      if(!alive)return;
      // Fallos transitorios de sesión, Vercel o red no desactivan la estación.
      // Antes el primer error hacía setEnabled(false) y el trabajador quedaba
      // detenido indefinidamente hasta recargar la aplicación.
      setTemplate(null);
      const delay=retryDelay;
      retryDelay=Math.min(retryDelay*2,30000);
      retryTimer=window.setTimeout(()=>{
        retryTimer=null;
        void loadTemplate();
      },delay);
    }finally{
      loading=false;
    }
  };
  const retryOnWake=()=>{
    if(!alive||ready||loading)return;
    if(retryTimer!==null){window.clearTimeout(retryTimer);retryTimer=null;}
    void loadTemplate();
  };
  const retryOnVisible=()=>{
    if(document.visibilityState==="visible")retryOnWake();
  };
  void loadTemplate();
  window.addEventListener("online",retryOnWake);
  window.addEventListener("focus",retryOnWake);
  document.addEventListener("visibilitychange",retryOnVisible);
  return ()=>{
    alive=false;
    if(retryTimer!==null)window.clearTimeout(retryTimer);
    window.removeEventListener("online",retryOnWake);
    window.removeEventListener("focus",retryOnWake);
    document.removeEventListener("visibilitychange",retryOnVisible);
  };
 },[enabled]);
 if(!enabled||!template)return null;
 return <PrintStation template={template} preview={false} hiddenMode/>;
}
