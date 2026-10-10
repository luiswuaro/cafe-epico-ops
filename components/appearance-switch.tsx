"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const KEY = "cafe-epico-ops-theme-v1";
const themes: Array<{value:Theme;label:string;symbol:string}> = [
  {value:"light",label:"Claro",symbol:"☀"},
  {value:"dark",label:"Oscuro",symbol:"☾"},
  {value:"system",label:"Auto",symbol:"◐"},
];

/** Sets the theme on <html>, so all employee and admin routes inherit it. */
export function AppearanceSwitch({compact=false}:{compact?:boolean}){
  const [theme,setTheme] = useState<Theme>("system");

  useEffect(()=>{
    let saved:Theme="system";
    try {
      const value=window.localStorage.getItem(KEY);
      if(value==="light"||value==="dark"||value==="system")saved=value;
    } catch { /* Keep system appearance. */ }
    // Defer setting React state until after hydration; avoids server/client mismatch.
    document.documentElement.setAttribute("data-theme",saved);
    const task=window.setTimeout(()=>setTheme(saved),0);
    return ()=>window.clearTimeout(task);
  },[]);

  function change(next:Theme){
    setTheme(next);
    document.documentElement.setAttribute("data-theme",next);
    try{window.localStorage.setItem(KEY,next);}catch{/* Persistent storage optional. */}
  }

  return <div className={"ops-appearance"+(compact?" ops-appearance-compact":"")}>
    <span className="ops-appearance-title">Apariencia</span>
    <div className="ops-theme-options" role="group" aria-label="Tema visual de OPS">
      {themes.map(item=><button key={item.value} type="button"
        aria-pressed={theme===item.value} title={item.label}
        className={theme===item.value?"is-selected":""}
        onClick={()=>change(item.value)}>
        <span aria-hidden="true">{item.symbol}</span>
        <span>{item.label}</span>
      </button>)}
    </div>
  </div>;
}
