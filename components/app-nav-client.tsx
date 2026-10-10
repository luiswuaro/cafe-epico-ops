"use client";

import Link from "next/link";
import {createPortal} from "react-dom";
import {useEffect,useState,useSyncExternalStore} from "react";
import {usePathname} from "next/navigation";
import {AppearanceSwitch} from "./appearance-switch";

type IconName="home"|"pos"|"orders"|"cash"|"tasks"|"handoff"|"inventory"|"receipt"|"people"|"insights"|"audit"|"clock"|"recipes"|"sops"|"quality"|"issue"|"manage"|"settings"|"account"|"menu"|"close";
type Entry={label:string;href:string;icon:IconName};
const entry=(label:string,href:string,icon:IconName):Entry=>({label,href,icon});
const subscribe=()=>()=>{};
function useHasDOM(){
  return useSyncExternalStore(subscribe,()=>true,()=>false);
}
function Glyph({name}:{name:IconName}){
  const common={fill:"none",stroke:"currentColor",strokeWidth:1.8,strokeLinecap:"round" as const,strokeLinejoin:"round" as const};
  let content;
  switch(name){
    case "home":content=<><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></>;break;
    case "pos":content=<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 14h4M7 17h7"/></>;break;
    case "orders":content=<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>;break;
    case "cash":content=<><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 11h18M7 15h3M7 4h10"/></>;break;
    case "tasks":content=<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 2 2 4-4M8 16h8"/></>;break;
    case "handoff":content=<><path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/></>;break;
    case "inventory":content=<><path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9"/></>;break;
    case "receipt":content=<><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3M9 8h6M9 12h6"/></>;break;
    case "people":content=<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/></>;break;
    case "insights":content=<><path d="M4 19V5M4 19h17M8 15l4-5 3 2 5-7"/></>;break;
    case "audit":content=<><path d="M4 20V4h16v16H4M8 9h8M8 13h8M8 17h5"/></>;break;
    case "clock":content=<><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>;break;
    case "recipes":content=<><path d="M5 3h10a4 4 0 0 1 4 4v14H8a3 3 0 0 1-3-3V3M5 17h14M9 8h6M9 12h5"/></>;break;
    case "sops":content=<><path d="M7 3h10l4 4v14H3V3h4M8 11h9M8 15h9M8 19h6"/></>;break;
    case "quality":content=<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></>;break;
    case "issue":content=<><path d="M12 3 2 21h20L12 3ZM12 9v5M12 18h.01"/></>;break;
    case "manage":case "settings":content=<><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></>;break;
    case "account":content=<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>;break;
    case "menu":content=<path d="M4 7h16M4 12h16M4 17h16"/>;break;
    case "close":content=<path d="M5 5l14 14M19 5 5 19"/>;break;
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" {...common}>{content}</svg>;
}

export function AppNavClient({canAdmin,canPos,canCash}:{
  canAdmin:boolean;canPos:boolean;canCash:boolean;
}){
  const [open,setOpen]=useState(false);
  const hasDOM=useHasDOM();
  const pathname=usePathname();
  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    window.addEventListener("keydown",escape);
    return ()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",escape);};
  },[open]);

  const groups=[
    {title:"Operación",items:[
      entry("Hoy","/today","home"),
      ...(canPos?[entry("Punto de venta","/pos","pos"),entry("Comandas y mesas","/pos/orders","orders")]:[]),
      ...(canCash?[entry("Caja","/pos/cash","cash")]:[]),
      entry("Checklist","/checklists","tasks"),entry("Entrega de turno","/handoff","handoff"),
    ]},
    {title:"Control",items:[
      entry("Inventario","/inventory","inventory"),
      ...(canPos?[entry("Tickets e historial","/pos/tickets","receipt"),
        entry("Clientes y puntos","/pos/customers","people"),
        entry("Visitas y preferencias","/pos/customers/insights","insights"),
        entry("Inventario por venta","/pos/inventory-audit","audit"),
        entry("Historial de cajas","/pos/cash/history","clock")]:[]),
    ]},
    {title:"Barra",items:[entry("Recetas","/recipes","recipes"),entry("Procedimientos","/sops","sops"),
      entry("Calidad de espresso","/quality/espresso","quality"),
      entry("Reportar incidencia","/operations/report","issue")]},
    ...(canAdmin?[{title:"Administración",items:[
      entry("Catálogo y precios","/admin/pos/catalog","manage"),
      entry("Ticket térmico","/admin/pos/ticket","receipt"),
      entry("Tareas del equipo","/admin/checklists","tasks"),
      entry("Turnos","/admin/reports/shifts","clock"),
      entry("Productividad","/admin/reports/productivity","insights"),
      entry("Tueste","/admin/roasting","quality"),
      entry("Centro financiero","/admin/finance","insights"),
      entry("Configuración","/admin","settings"),
    ]}]:[]),
    {title:"Mi cuenta",items:[entry("Perfil y seguridad","/account/security","account")]},
  ];

  const active=(href:string)=>href==="/pos"?pathname===href:pathname===href||pathname.startsWith(href+"/");
  const navLink=(item:Entry,short=false)=><Link key={item.href} href={item.href}
    className={(short?"ops-shortcut ":"ops-drawer-link ")+(active(item.href)?"is-active":"")}
    aria-current={active(item.href)?"page":undefined}
    onClick={()=>setOpen(false)}>
      <span className="ops-nav-icon"><Glyph name={item.icon}/></span>
      <span>{item.label}</span>
    </Link>;

  const portalContent=<>
    {open&&<div className="ops-drawer-root">
      <button type="button" className="ops-drawer-backdrop" onClick={()=>setOpen(false)}
        aria-label="Cerrar el menú"/>
      <aside id="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="ops-drawer-title" className="ops-drawer">
        <header className="ops-drawer-head">
          <div className="ops-drawer-identity">
            <strong id="ops-drawer-title">Café Épico</strong>
            <span>Centro de operaciones</span>
          </div>
          <button type="button" className="ops-drawer-close" onClick={()=>setOpen(false)}
            aria-label="Cerrar menú" autoFocus><Glyph name="close"/></button>
        </header>
        <div className="ops-drawer-appearance"><AppearanceSwitch/></div>
        <nav className="ops-drawer-list" aria-label="Todas las secciones">
          {groups.map(group=><section key={group.title} className="ops-drawer-group">
            <p>{group.title}</p>
            {group.items.map(item=>navLink(item))}
          </section>)}
          <form className="ops-drawer-signout" action="/auth/signout" method="post">
            <button type="submit">Cerrar sesión</button>
          </form>
        </nav>
      </aside>
    </div>}
    <nav className="ops-mobile-tabs" aria-label="Accesos principales">
      {navLink(entry("Hoy","/today","home"),true)}
      {canPos&&navLink(entry("POS","/pos","pos"),true)}
      {canPos&&navLink(entry("Mesas","/pos/orders","orders"),true)}
      {canCash&&navLink(entry("Caja","/pos/cash","cash"),true)}
      <button type="button" className={open?"is-active":""} aria-label="Abrir menú completo"
        aria-expanded={open} onClick={()=>setOpen(true)}>
        <span className="ops-nav-icon"><Glyph name="menu"/></span><span>Más</span>
      </button>
    </nav>
  </>;

  return <>
    <div className="ops-nav-shell">
      <nav className="ops-desktop-shortcuts" aria-label="Accesos rápidos">
        {navLink(entry("Hoy","/today","home"),true)}
        {canPos&&navLink(entry("POS","/pos","pos"),true)}
        {canPos&&navLink(entry("Comandas","/pos/orders","orders"),true)}
        {canCash&&navLink(entry("Caja","/pos/cash","cash"),true)}
      </nav>
      <AppearanceSwitch compact/>
      <button type="button" className="ops-menu-trigger" onClick={()=>setOpen(!open)}
        aria-expanded={open} aria-controls="ops-drawer"
        aria-label={open?"Cerrar menú completo":"Abrir menú completo"}>
        <Glyph name="menu"/><span>Menú</span>
      </button>
    </div>
    {hasDOM&&createPortal(portalContent,document.body)}
  </>;
}
