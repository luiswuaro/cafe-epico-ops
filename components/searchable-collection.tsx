"use client";

import { useEffect,useMemo,useRef,useState, type FormEvent,type ReactNode } from "react";

export type SearchableEntry = {
  id: string;
  name: string;
  category?: string;
  status?: string;
  searchText?: string;
  content: ReactNode;
};

type Props = {
  entries: SearchableEntry[];
  label: string;
  placeholder?: string;
  listClassName?: string;
  categoryLabel?: string;
  statusLabel?: string;
  defaultStatus?: string;
  emptyText?: string;
  persistKey?:string;
  resumeId?:string|null;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX").replace(/\s+/g, " ").trim();
}

/**
 * Filtrado 100% local. Nunca consulta ni modifica existencias/recetas.
 * Los renglones ocultos siguen montados: no pierde formularios abiertos ni
 * cambios sin guardar al cambiar de filtro.
 */
export function SearchableCollection({
  entries, label, placeholder="Buscar por nombre, ingrediente o código...",
  listClassName, categoryLabel="Categoría", statusLabel="Estado",
  defaultStatus="", emptyText="No hay coincidencias con esos filtros.",
  persistKey,resumeId,
}: Props) {
  const [query, setQuery] = useState("");
  const root=useRef<HTMLDivElement>(null);
  const restored=useRef(false);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState(() => defaultStatus && entries.some(item=>item.status===defaultStatus) ? defaultStatus : "");
  const categories = useMemo(
    () => [...new Set(entries.map(item => item.category).filter((x):x is string=>Boolean(x)))].sort((a,b)=>a.localeCompare(b,"es-MX")),
    [entries],
  );
  const statuses = useMemo(
    () => [...new Set(entries.map(item => item.status).filter((x):x is string=>Boolean(x)))],
    [entries],
  );
  const visible = useMemo(()=>{
    const words=normalize(query).split(" ").filter(Boolean);
    return new Set(entries.filter(item=>{
      if(category && item.category!==category)return false;
      if(status && item.status!==status)return false;
      if(!words.length)return true;
      const text=normalize([item.name,item.category,item.status,item.searchText].filter(Boolean).join(" "));
      return words.every(word=>text.includes(word));
    }).map(item=>item.id));
  },[entries,query,category,status]);
  const reset=()=>{setQuery("");setCategory("");setStatus("");};
  useEffect(()=>{
    if(!persistKey)return;
    try{
      const value=window.sessionStorage.getItem(persistKey+":filters");
      if(value){
        const old=JSON.parse(value) as {query?:string;category?:string;status?:string};
        window.requestAnimationFrame(()=>{
          setQuery(old.query??"");setCategory(old.category??"");setStatus(old.status??"");
        });
      }
    }catch{/* navegación normal cuando el almacenamiento esté deshabilitado */}
    restored.current=true;
  },[persistKey]);
  useEffect(()=>{
    if(!persistKey||!restored.current)return;
    try{window.sessionStorage.setItem(persistKey+":filters",JSON.stringify({query,category,status}));}
    catch{/* sin almacenamiento: el filtro todavía funciona */}
  },[persistKey,query,category,status]);
  useEffect(()=>{
    if(!persistKey)return;
    const raw=window.sessionStorage.getItem(persistKey+":return");
    if(!raw)return;
    let cancelled=false;
    let frame=0;
    try{
      const saved=JSON.parse(raw) as {scrollY:number;itemId?:string;offset?:number;open?:string[]};
      // Rehidratar los filtros antes de reposicionar. El producto se identifica por ID
      // estable, no por el nombre ni por el índice de la lista.
      frame=window.requestAnimationFrame(()=>{
        window.requestAnimationFrame(()=>{
          if(cancelled)return;
          const entry=saved.itemId?[...root.current?.querySelectorAll<HTMLElement>("[data-search-entry]")??[]]
            .find(element=>element.dataset.searchEntry===saved.itemId):undefined;
          // display:contents does not have its own bounding box.
          // Anchor to the visible article inside it instead.
          const anchor=entry?.firstElementChild instanceof HTMLElement
            ?entry.firstElementChild:entry;
          if(entry && anchor?.getClientRects().length){
            for(const details of entry.querySelectorAll<HTMLDetailsElement>("details[data-save-state]"))
              details.open=Boolean(saved.open?.includes(details.dataset.saveState??""));
            const top=anchor.getBoundingClientRect().top+window.scrollY-(saved.offset??0);
            window.scrollTo({top:Math.max(0,top),behavior:"instant"});
          }else{
            window.scrollTo({top:saved.scrollY??0,behavior:"instant"});
          }
          window.sessionStorage.removeItem(persistKey+":return");
        });
      });
    }catch{window.sessionStorage.removeItem(persistKey+":return");}
    return ()=>{cancelled=true;window.cancelAnimationFrame(frame);};
  },[persistKey,resumeId,entries.length,query,category,status]);
  function rememberPosition(event:FormEvent<HTMLDivElement>){
    if(!persistKey)return;
    const target=event.target;
    if(!(target instanceof HTMLFormElement))return;
    const entry=target.closest<HTMLElement>("[data-search-entry]");
    const anchor=entry?.firstElementChild instanceof HTMLElement
      ?entry.firstElementChild:entry;
    try{
      window.sessionStorage.setItem(persistKey+":return",JSON.stringify({
        itemId:entry?.dataset.searchEntry,offset:anchor?.getBoundingClientRect().top,
        scrollY:window.scrollY,
        open:entry?[...entry.querySelectorAll<HTMLDetailsElement>("details[data-save-state]")]
          .filter(x=>x.open).map(x=>x.dataset.saveState):[],
      }));
    }catch{/* el guardado no depende de la memoria de navegación */}
  }
  return (
    <div className="stack" ref={root} onSubmitCapture={rememberPosition}>
      <div className="card stack" style={{gap:12}}>
        <label htmlFor={"search-"+label.replace(/[^a-zA-Z0-9]/g,"-")}>
          <strong>Buscar {label}</strong>
        </label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <input
            id={"search-"+label.replace(/[^a-zA-Z0-9]/g,"-")}
            type="search" value={query}
            onChange={event=>setQuery(event.target.value)}
            placeholder={placeholder} autoComplete="off"
            aria-label={"Buscar "+label}
            style={{flex:"2 1 230px",minWidth:160}}
          />
          {categories.length>1 && <label style={{flex:"1 1 155px",minWidth:130}}>
            {categoryLabel}
            <select aria-label={categoryLabel} value={category} onChange={event=>setCategory(event.target.value)}>
              <option value="">Todas</option>
              {categories.map(value=><option key={value} value={value}>{value}</option>)}
            </select>
          </label>}
          {statuses.length>1 && <label style={{flex:"1 1 155px",minWidth:130}}>
            {statusLabel}
            <select aria-label={statusLabel} value={status} onChange={event=>setStatus(event.target.value)}>
              <option value="">Todos</option>
              {statuses.map(value=><option key={value} value={value}>{value}</option>)}
            </select>
          </label>}
          {(query||category||status) && <button type="button" className="button" onClick={reset}>Limpiar filtros</button>}
        </div>
        <p className="muted" aria-live="polite" style={{margin:0}}>
          Mostrando <strong>{visible.size}</strong> de <strong>{entries.length}</strong> {label}.
          {" "}Búsqueda inmediata, sin cambiar existencias.
        </p>
      </div>
      {visible.size===0 && <p className="card muted" role="status">{emptyText}</p>}
      <div className={listClassName ?? "stack"}>
        {entries.map(item=>(
          <div key={item.id} data-search-entry={item.id} style={{display:visible.has(item.id)?"contents":"none"}}>
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}
