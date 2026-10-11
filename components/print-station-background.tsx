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
   }catch{setEnabled(false)}
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
  void getPrintStationTemplate().then(settings=>{if(alive)setTemplate(settings)})
   .catch(()=>{if(alive)setEnabled(false)});
  return ()=>{alive=false};
 },[enabled]);
 if(!enabled||!template)return null;
 return <PrintStation template={template} preview={false} hiddenMode/>;
}
