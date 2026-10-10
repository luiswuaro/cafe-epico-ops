"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Lot = {
  id:string;name:string;greenStockG:number|null;greenStockSource:string;
  targetUse:string;hibeanGreenStockG:number|null;internalGreenStockG:number|null;
};
type ConfirmedBatch = {
  id:string;coffeeLotId:string;batchCode:string;roastedAt:string;
  greenWeightG:number;roastedWeightG:number;inventoryPosted:boolean;
};
type PlanConfig = {
  lotId:string;target:string;charge:string;loss:string;
  destination:string;startDate:string;
};
type PlannedBatch = {
  number:number;green:number;estimated:number;
  actual:number|null;loss:number|null;confirmed:ConfirmedBatch|null;
  draftWeight:string;invalid:boolean;
};

const PLAN_KEY="cafe-epico-roasting-session-planner-v2";
const fmt=(n:number,d=0)=>new Intl.NumberFormat("es-MX",{
  maximumFractionDigits:d,
}).format(n);
const mxDate=(date:Date)=>new Intl.DateTimeFormat("sv-SE",{
  timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit",
}).format(date);

export function RoastingSessionPlanner({
  lots,batches,
}:{
  lots:Lot[];batches:ConfirmedBatch[];
}){
  const router=useRouter();
  const [config,setConfig]=useState<PlanConfig>({
    lotId:lots[0]?.id??"",target:"5000",charge:"400",
    loss:"15",destination:"OMNI",startDate:"",
  });
  const [draftWeights,setDraftWeights]=useState<Record<string,string>>({});
  const [hydrated,setHydrated]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [copied,setCopied]=useState(false);

  // The real batch ledger lives in OPS and is read on every server refresh.
  // Only hypothetical settings and unconfirmed weigh-ins stay in this browser.
  useEffect(()=>{
    const task=window.setTimeout(()=>{
      let saved:Partial<PlanConfig>={};
      let weights:Record<string,string>={};
      try{
        const value=JSON.parse(window.localStorage.getItem(PLAN_KEY)??"null");
        if(value&&typeof value==="object"){
          if(value.config&&typeof value.config==="object")saved=value.config;
          if(value.draftWeights&&typeof value.draftWeights==="object")weights=value.draftWeights;
        }else{
          // One-time migration of older session planner: preserve recorded
          // manual weights but never count them twice once a batch is confirmed.
          const old=JSON.parse(window.localStorage.getItem("cafe-epico-roasting-session-planner-v1")??"null");
          if(old&&typeof old==="object"){
            saved={lotId:old.lotId,target:old.target,charge:old.charge,
              loss:old.loss,destination:old.destination};
            if(old.realWeights&&typeof old.realWeights==="object"){
              Object.entries(old.realWeights).forEach(([index,value])=>{
                if(typeof value==="string")weights["legacy:"+index]=value;
              });
            }
          }
        }
      }catch{/* Continue with defaults. */}
      const query=new URLSearchParams(window.location.search);
      const date=mxDate(new Date());
      setConfig(previous=>({
        ...previous,
        lotId:query.get("sessionLot")||saved.lotId||previous.lotId,
        target:query.get("sessionTarget")||saved.target||previous.target,
        charge:query.get("sessionCharge")||saved.charge||previous.charge,
        loss:query.get("sessionLoss")||saved.loss||previous.loss,
        destination:query.get("sessionDest")||saved.destination||previous.destination,
        startDate:query.get("sessionStart")||saved.startDate||date,
      }));
      setDraftWeights(weights);
      setHydrated(true);
    },0);
    return ()=>window.clearTimeout(task);
  },[]);
  useEffect(()=>{
    if(!hydrated)return;
    try{window.localStorage.setItem(PLAN_KEY,JSON.stringify({
      config,draftWeights,
    }));}catch{/* Offline storage is optional. */}
  },[config,draftWeights,hydrated]);

  const selected=lots.find(l=>l.id===config.lotId);
  const target=Number(config.target);
  const charge=Number(config.charge);
  const lossPct=Number(config.loss);
  const valid=Number.isFinite(target)&&target>0&&target<=25000&&
    Number.isFinite(charge)&&charge>=100&&charge<=500&&
    Number.isFinite(lossPct)&&lossPct>=0&&lossPct<40;

  const confirmed=useMemo(()=>batches.filter(b=>
    b.coffeeLotId===config.lotId&&
    config.startDate!==""&&mxDate(new Date(b.roastedAt))>=config.startDate,
  ).sort((a,b)=>new Date(a.roastedAt).getTime()-new Date(b.roastedAt).getTime()),
  [batches,config.lotId,config.startDate]);

  const plan=useMemo<PlannedBatch[]>(()=>{
    if(!valid)return [];
    // Confirmed batches can have a different charge (e.g. the last
    // 200 g or a test batch). Plan the remainder from actual consumption,
    // not the assumption that every confirmed batch weighed "charge" grams.
    const postedGreen=confirmed.reduce((sum,b)=>sum+b.greenWeightG,0);
    const remainingGreen=Math.max(0,target-postedGreen);
    const total=confirmed.length+Math.ceil(remainingGreen/charge);
    return Array.from({length:total},(_,index)=>{
      const recorded=confirmed[index]??null;
      const pendingIndex=index-confirmed.length;
      const green=recorded?.greenWeightG??
        Math.min(charge,remainingGreen-pendingIndex*charge);
      const expected=green*(1-lossPct/100);
      const key=config.lotId+":"+config.startDate+":"+index;
      const draftWeight=draftWeights[key]??draftWeights["legacy:"+index]??"";
      const candidate=draftWeight.trim()?Number(draftWeight):null;
      const invalid=!recorded&&candidate!==null&&
        (!Number.isFinite(candidate)||candidate<=0||candidate>green);
      const actual=recorded?.roastedWeightG??
        (candidate!==null&&!invalid?candidate:null);
      return {
        number:index+1,green,estimated:expected,actual,
        loss:actual===null?null:100*(green-actual)/green,
        confirmed:recorded,draftWeight,invalid,
      };
    });
  },[target,charge,lossPct,valid,confirmed,config.lotId,config.startDate,draftWeights]);

  const confirmedGreen=confirmed.reduce((n,b)=>n+b.greenWeightG,0);
  const confirmedRoasted=confirmed.reduce((n,b)=>n+b.roastedWeightG,0);
  const pendingGreen=Math.max(0,target-confirmedGreen);
  const measured=plan.filter(b=>b.actual!==null);
  const locallyMeasured=plan.filter(b=>b.actual!==null&&!b.confirmed);
  const realRoasted=plan.reduce((sum,b)=>sum+(b.actual??0),0);
  const estimatedRoasted=plan.reduce((sum,b)=>sum+b.estimated,0);
  const nextIndex=plan.findIndex(b=>!b.confirmed);
  const donePct=plan.length?Math.min(100,confirmed.length/plan.length*100):0;
  // Compare only unposted green with the live stock (not the original target).
  const outOfStock=selected?.greenStockG!=null&&pendingGreen>selected.greenStockG+0.01;
  const overRecorded=confirmedGreen>target+.01;
  const savedLocally=locallyMeasured.length;
  const historicalMismatch=selected?.greenStockSource==="INTERNAL"&&
    selected.hibeanGreenStockG!=null&&selected.greenStockG!=null&&
    Math.abs(selected.greenStockG-selected.hibeanGreenStockG)>1;

  const update=(patch:Partial<PlanConfig>)=>setConfig(x=>({...x,...patch}));
  function setDraft(index:number,value:string){
    const key=config.lotId+":"+config.startDate+":"+index;
    setDraftWeights(old=>({...old,[key]:value,["legacy:"+index]:""}));
  }
  function copyPlan(){
    const text=[
      "CAFÉ ÉPICO · PLAN DE TUESTE",
      "Café: "+(selected?.name??"Sin lote"),
      "Inicio: "+config.startDate,
      "Meta: "+fmt(target)+" g · Carga: "+fmt(charge)+" g",
      "Registrados OPS: "+confirmed.length+" batches · "+fmt(confirmedGreen)+" g verdes",
      "Pendiente: "+fmt(pendingGreen)+" g · Stock actual OPS: "+
        (selected?.greenStockG==null?"No mapeado":fmt(selected.greenStockG)+" g"),
      ...plan.map(b=>"#"+b.number+" · "+fmt(b.green)+" g → "+
        (b.actual==null?"pendiente":fmt(b.actual,1)+" g")+
        " · "+(b.confirmed?"Confirmado OPS":b.actual===null?"Por tostar":"Pesado local")),
    ].join("\n");
    void navigator.clipboard?.writeText(text).then(()=>{
      setCopied(true);window.setTimeout(()=>setCopied(false),2400);
    }).catch(()=>setCopied(false));
  }
  function copyLink(){
    const query=new URLSearchParams();
    query.set("sessionLot",config.lotId);
    query.set("sessionTarget",config.target);
    query.set("sessionCharge",config.charge);
    query.set("sessionLoss",config.loss);
    query.set("sessionDest",config.destination);
    query.set("sessionStart",config.startDate);
    const url=window.location.origin+"/admin/roasting?"+query.toString()+"#plan-sesion";
    void navigator.clipboard?.writeText(url).then(()=>{
      setCopied(true);window.setTimeout(()=>setCopied(false),2400);
    }).catch(()=>setCopied(false));
  }
  function reloadRegistered(){
    setRefreshing(true);router.refresh();window.setTimeout(()=>setRefreshing(false),1600);
  }

  return <section className="ops-roast-session" aria-label="Planificador de sesión Skywalker">
    <div className="ops-roast-overview">
      <div className="ops-roast-overview-main">
        <p className="eyebrow">SESIONES · SKYWALKER V1</p>
        <h3>Tueste bajo control</h3>
        <p>Prepara cada carga, pesa la salida y enlaza el JSON. Las confirmaciones reales vienen de OPS, no de esta pantalla.</p>
        <div className="ops-roast-actions">
          <button type="button" className="ops-action-soft"
            onClick={reloadRegistered} disabled={refreshing}>
            {refreshing?"Actualizando…":"↻ Actualizar batches"}
          </button>
          <button type="button" className="ops-action-soft" onClick={copyLink}>
            ↗ Compartir configuración
          </button>
        </div>
        {copied&&<small role="status" className="status-ok">Copiado al portapapeles</small>}
      </div>
      <div className="ops-roast-progress">
        <span>PROGRESO CONFIRMADO</span>
        <strong>{confirmed.length}<small> / {plan.length||"—"}</small></strong>
        <div className="ops-progress-track" role="progressbar"
          aria-label="Batches confirmados" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(donePct)}>
          <div style={{width:donePct+"%"}}/>
        </div>
        <span>{fmt(donePct,0)}% de los batches previstos</span>
      </div>
    </div>

    <div className="ops-roast-steps" aria-label="Etapas de la sesión">
      <a href="#roast-setup"><span>01</span> Preparar</a>
      <a href="#roast-batches"><span>02</span> Producir</a>
      <a href="#importar-hibean"><span>03</span> Confirmar</a>
    </div>

    <details className="ops-roast-setup" id="roast-setup" open>
      <summary>
        <span className="ops-step-number">01</span>
        <span><strong>Configuración de sesión</strong>
          <small>Elige café, cantidad inicial y carga por batch</small></span>
        <span className="ops-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="ops-roast-form">
        <label>Lote de café
          <select value={config.lotId} onChange={e=>update({lotId:e.target.value})}>
            {lots.length===0&&<option value="">No hay lotes activos</option>}
            {lots.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label>Inicio de sesión
          <input type="date" value={config.startDate} max="2099-12-31"
            onChange={e=>update({startDate:e.target.value})}/>
        </label>
        <label>Verde total de la sesión (g)
          <input type="number" min="1" max="25000" step="1"
            value={config.target} onChange={e=>update({target:e.target.value})}/>
        </label>
        <label>Carga nominal (g)
          <select value={config.charge} onChange={e=>update({charge:e.target.value})}>
            <option value="500">500 g · Skywalker</option>
            <option value="400">400 g · Skywalker</option>
            <option value="333">333 g · Skywalker</option>
            <option value="250">250 g · pruebas</option>
          </select>
        </label>
        <label>Merma objetivo (%)
          <input type="number" min="0" max="39.9" step=".1"
            value={config.loss} onChange={e=>update({loss:e.target.value})}/>
        </label>
        <label>Destino del café
          <select value={config.destination} onChange={e=>update({destination:e.target.value})}>
            <option value="ESPRESSO">Espresso</option>
            <option value="OMNI">Omni</option>
            <option value="FILTER">Filtrado</option>
          </select>
        </label>
      </div>
      <p className="ops-helper">
        «Inicio de sesión» incluye los tuestes de ese lote desde la fecha indicada.
        Si comenzaste ayer, conserva la fecha inicial. Cambiar la configuración
        no modifica inventarios ni los batches ya registrados.
      </p>
    </details>

    <div className="ops-roast-metrics" aria-live="polite">
      <div className="ops-roast-stat"><span>Verde disponible OPS</span>
        <strong>{selected?.greenStockG==null?"—":fmt(selected.greenStockG)+" g"}</strong>
        <small>{selected?.greenStockSource==="INTERNAL"?"Inventario real OPS":"Referencia HiBean / sin mapear"}</small>
      </div>
      <div className="ops-roast-stat"><span>Por registrar</span>
        <strong>{valid?fmt(pendingGreen)+" g":"—"}</strong>
        <small>Meta menos batches confirmados</small>
      </div>
      <div className="ops-roast-stat"><span>Salida prevista</span>
        <strong>{valid?fmt(estimatedRoasted/1000,2)+" kg":"—"}</strong>
        <small>Merma planificada {fmt(lossPct||0,1)}%</small>
      </div>
      <div className="ops-roast-stat"><span>Tostado confirmado</span>
        <strong>{fmt(confirmedRoasted,1)} g</strong>
        <small>{measured.length} medidos · {savedLocally} sólo aquí</small>
      </div>
    </div>

    {!valid&&<p className="ops-inline-notice is-error" role="alert">
      Revisa la meta, la carga (100–500 g) y el porcentaje de merma.
    </p>}
    {outOfStock&&<p className="ops-inline-notice is-warning" role="alert">
      Faltan {fmt(pendingGreen-selected!.greenStockG!)} g para cumplir la meta.
      Estás comparando únicamente lo pendiente, no los 5 kg originales.
      Comprueba el stock físico antes del próximo batch.
    </p>}
    {overRecorded&&<p className="ops-inline-notice is-warning">
      Los batches registrados desde esta fecha ya exceden la meta definida.
      Revisa la fecha inicial o aumenta la meta de la sesión.
    </p>}
    {historicalMismatch&&selected&&<p className="ops-inline-notice">
      HiBean histórico: {fmt(selected.hibeanGreenStockG!)} g.
      OPS: {fmt(selected.greenStockG!)} g. La diferencia no se suma ni descuenta de nuevo.
    </p>}

    <div className="ops-roast-batches-heading" id="roast-batches">
      <div><p className="eyebrow">02 · PRODUCCIÓN</p><h3>Cargas de la sesión</h3>
        <p className="muted">Abre una tarjeta para ver pesos, merma y estado. Los registros verdes vienen de OPS.</p>
      </div>
      <span className="ops-counter">{confirmed.length}/{plan.length} confirmados</span>
    </div>
    <div className="ops-roast-batch-grid">
      {plan.map((b,index)=>{
        const status=b.confirmed?"Confirmado OPS":b.actual!==null?"Pesado · pendiente JSON":"Por tostar";
        return <details className={"ops-roast-batch"+(b.confirmed?" is-confirmed":b.actual!==null?" is-weighed":"")}
          key={index} open={index===nextIndex} >
          <summary>
            <span className="ops-batch-index">{String(b.number).padStart(2,"0")}</span>
            <span className="ops-batch-title">
              <strong>Batch {b.number}</strong>
              <small>{fmt(b.green)} g verde · {fmt(b.estimated,1)} g previsto</small>
            </span>
            <span className="ops-batch-status">{status}</span>
            <span className="ops-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="ops-batch-details">
            {b.confirmed?<div className="ops-confirmed-weight">
              <span>Tostado registrado en OPS</span>
              <strong>{fmt(b.actual!,1)} g</strong>
              <small>{b.confirmed.batchCode} · {mxDate(new Date(b.confirmed.roastedAt))}</small>
            </div>:<label>Peso tostado medido (g)
              <input type="number" step=".1" min=".1" max={b.green}
                placeholder="Pesa al enfriar" value={b.draftWeight}
                onChange={e=>setDraft(index,e.target.value)}/>
            </label>}
            <div className="ops-batch-detail-metrics">
              <span>Merma real <strong>{b.loss==null?"—":fmt(b.loss,2)+"%"}</strong></span>
              <span>Objetivo <strong>{fmt(lossPct,1)}%</strong></span>
            </div>
            {b.invalid&&<small className="status-warn">El tostado debe ser mayor a cero y no superar la carga verde.</small>}
            {!b.confirmed&&<a className="ops-primary-link" href="#importar-hibean">
              Importar JSON del batch <span aria-hidden="true">↗</span>
            </a>}
          </div>
        </details>;
      })}
    </div>

    <div className="ops-roast-footer">
      <div>
        <strong>Avance de sesión</strong>
        <p>{fmt(confirmedGreen)} g verde consumidos en OPS · {fmt(realRoasted,1)} g tostados medidos, incluidos borradores locales.</p>
        <small>Los pesos sin JSON son anotaciones locales, no descuentan inventario.
          Los batches confirmados sí se sincronizan desde OPS al actualizar la página.
          La configuración se conserva en este navegador y puede compartirse con el enlace.</small>
      </div>
      <div className="ops-roast-footer-actions">
        <button type="button" className="ops-action-soft" onClick={copyPlan}>Copiar resumen</button>
        <a className="ops-primary-link" href="#importar-hibean">Importar siguiente JSON →</a>
      </div>
    </div>
  </section>;
}
