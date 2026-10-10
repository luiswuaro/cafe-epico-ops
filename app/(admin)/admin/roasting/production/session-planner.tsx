"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Lot = {
  id:string; name:string; greenStockG:number|null;
  greenStockSource:string; averageLossPct:number|null;
  greenCostPerKg:number|null; targetUse:string;
};
type Batch = {
  id:string; lotId:string; code:string; date:string;
  greenG:number; roastedG:number; dtrPct:number|null;
  lossPct:number; provider:string|null; inventoryPosted:boolean;
};
const STORE_KEY="cafe-epico-roast-production-plan-v1";
const number=new Intl.NumberFormat("es-MX",{maximumFractionDigits:1});
const peso=(g:number)=>number.format(g)+" g";
type Draft={lotId:string;total:string;charge:string;loss:string;date:string;use:string;actuals:Record<string,string>};

function mexicoDate(date:Date){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
function defaultDate(){const d=new Date();d.setDate(d.getDate()+1);return mexicoDate(d);}

export function RoastSessionPlanner({lots,batches}:{
  lots:Lot[];batches:Batch[];
}){
  const [lotId,setLotId]=useState("");
  const [total,setTotal]=useState("5000");
  const [charge,setCharge]=useState("500");
  const [loss,setLoss]=useState("16");
  const [date,setDate]=useState("");
  const [use,setUse]=useState("ESPRESSO");
  const [actuals,setActuals]=useState<Record<string,string>>({});
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    try{
      const raw=window.localStorage.getItem(STORE_KEY);
      if(raw){
        const saved=JSON.parse(raw) as Partial<Draft>;
        if(typeof saved.lotId==="string")setLotId(saved.lotId);
        if(typeof saved.total==="string")setTotal(saved.total);
        if(typeof saved.charge==="string")setCharge(saved.charge);
        if(typeof saved.loss==="string")setLoss(saved.loss);
        if(typeof saved.date==="string")setDate(saved.date);
        if(typeof saved.use==="string")setUse(saved.use);
        if(saved.actuals&&typeof saved.actuals==="object")setActuals(saved.actuals);
      }else setDate(defaultDate());
    }catch{setDate(defaultDate());}
    setLoaded(true);
  },[]);
  useEffect(()=>{
    if(!loaded)return;
    const draft:Draft={lotId,total,charge,loss,date,use,actuals};
    window.localStorage.setItem(STORE_KEY,JSON.stringify(draft));
  },[lotId,total,charge,loss,date,use,actuals,loaded]);

  const green=Number(total),maxCharge=Number(charge),lossPct=Number(loss);
  const valid=total.trim()!==""&&charge.trim()!==""&&loss.trim()!==""&&
    Number.isFinite(green)&&green>0&&green<=30000&&
    Number.isFinite(maxCharge)&&maxCharge>=100&&maxCharge<=500&&
    Number.isFinite(lossPct)&&lossPct>=0&&lossPct<=30;
  const rows=useMemo(()=>{
    if(!valid)return [];
    const grams=Math.round(green);
    const batches=Math.ceil(grams/maxCharge);
    if(batches>200)return [];
    const base=Math.floor(grams/batches);
    const remainder=grams%batches;
    return Array.from({length:batches},(_,index)=>{
      const plannedGreen=base+(index<remainder?1:0);
      return {index,green:plannedGreen,roasted:plannedGreen*(1-lossPct/100)};
    });
  },[valid,green,maxCharge,lossPct]);

  const lot=lots.find(row=>row.id===lotId);
  const confirmed=batches.filter(b=>b.date===date&&(!lotId||b.lotId===lotId));
  const confirmedGreen=confirmed.reduce((sum,b)=>sum+b.greenG,0);
  const confirmedRoasted=confirmed.reduce((sum,b)=>sum+b.roastedG,0);
  const expectedRoasted=rows.reduce((sum,b)=>sum+b.roasted,0);
  const actualList=rows.flatMap(row=>{
    const raw=actuals[String(row.index)];
    if(raw==null||raw.trim()==="")return [];
    const measured=Number(raw);
    if(!Number.isFinite(measured)||measured<=0||measured>row.green)return [];
    return [{green:row.green,roasted:measured}];
  });
  const actualGreen=actualList.reduce((sum,b)=>sum+b.green,0);
  const actualRoasted=actualList.reduce((sum,b)=>sum+b.roasted,0);
  const actualLoss=actualGreen>0?(1-actualRoasted/actualGreen)*100:null;
  const expectedLossG=green-expectedRoasted;
  const stock=lot?.greenStockG??null;
  const lotCost=lot?.greenCostPerKg??null;
  const shortage=stock==null?null:Math.max(0,green-stock);
  const priceKg=lotCost!=null&&expectedRoasted>0
    ?(green/1000*lotCost)/(expectedRoasted/1000):null;

  return <div className="stack" style={{gap:"1rem"}}>
    <section className="card stack">
      <p className="eyebrow">01 · PLAN DE PRODUCCIÓN</p>
      <h2>Programa tus 5 kg de café verde</h2>
      <p className="muted">
        El plan se guarda sólo en este navegador. No crea batches ni modifica inventario.
        Los datos definitivos se confirman al importar cada JSON de HiBean.
      </p>
      <div className="grid">
        <label>Lote / café
          <select value={lotId} onChange={e=>{setLotId(e.target.value);setActuals({});}}>
            <option value="">Nuevo lote / identificar desde JSON</option>
            {lots.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label>Fecha prevista (México)
          <input type="date" value={date} onChange={e=>setDate(e.target.value)}/>
        </label>
        <label>Café verde total (g)
          <input type="number" min="1" max="30000" step="1" value={total}
            onChange={e=>{setTotal(e.target.value);setActuals({});}}/>
        </label>
        <label>Carga máxima por batch (g)
          <input type="number" min="100" max="500" step="1" value={charge}
            onChange={e=>{setCharge(e.target.value);setActuals({});}}/>
        </label>
        <label>Merma esperada (%)
          <input type="number" min="0" max="30" step="0.1" value={loss}
            onChange={e=>setLoss(e.target.value)}/>
        </label>
        <label>Destino previsto
          <select value={use} onChange={e=>setUse(e.target.value)}>
            <option value="ESPRESSO">Espresso</option>
            <option value="OMNI">Omni</option>
            <option value="FILTER">Filtrado</option>
          </select>
        </label>
      </div>
      {!valid&&<p role="alert" className="status-warn">
        Revisa las cantidades: café verde 1–30,000 g, carga de Skywalker 100–500 g y merma 0–30%.
      </p>}
      {lot&&<div className="task">
        <div><strong>{lot.name}</strong>
          <p className="muted">
            Último saldo verde confirmado: {stock==null?"SIN DATO":peso(stock)}
            {" · "}{lot.greenStockSource==="HIBEAN_CONFIRMED"?"HiBean confirmado":
              lot.greenStockSource==="INTERNAL"?"Inventario OPS":"Sin vínculo de inventario"}
          </p>
          {stock!=null&&shortage!=null&&shortage>0&&
            <p className="status-warn">El plan supera el último saldo confirmado por {peso(shortage)}.
              Puede estar desactualizado; reconcilia el lote antes de confirmar el primer batch.</p>}
        </div>
      </div>}
      {!lot&&<p className="muted">
        Si tu café nuevo aún no aparece en OPS, déjalo en «Nuevo lote».
        El importador HiBean permitirá crear el lote y confirmar su inventario.
      </p>}
    </section>

    <section className="grid">
      <article className="card">
        <p className="eyebrow">CARGAS PLANIFICADAS</p>
        <div className="metric">{valid?rows.length:"—"}</div>
        <p className="muted">Reparto equilibrado sin último batch diminuto</p>
      </article>
      <article className="card">
        <p className="eyebrow">TOSTADO ESPERADO</p>
        <div className="metric">{valid?number.format(expectedRoasted/1000)+" kg":"—"}</div>
        <p className="muted">Merma estimada {valid?peso(expectedLossG):"—"}</p>
      </article>
      <article className="card">
        <p className="eyebrow">SALIDA PESADA EN EL PLAN</p>
        <div className="metric">{number.format(actualRoasted/1000)} kg</div>
        <p className="muted">{actualList.length} de {rows.length} pesos anotados
          {actualLoss==null?"":" · merma observada "+actualLoss.toFixed(2)+"%"}</p>
      </article>
      <article className="card">
        <p className="eyebrow">COSTO VERDE / KG TOSTADO</p>
        <div className="metric">{priceKg==null?"—":new Intl.NumberFormat("es-MX",
          {style:"currency",currency:"MXN",maximumFractionDigits:0}).format(priceKg)}</div>
        <p className="muted">Sólo materia prima; excluye energía, trabajo y empaque</p>
      </article>
    </section>

    <section className="card stack">
      <p className="eyebrow">02 · BITÁCORA DE CARGAS</p>
      <h2>Control de batches para la sesión</h2>
      <p className="muted">Los campos «peso real» son apuntes locales. El registro oficial
        y la curva vienen del JSON confirmado en OPS.</p>
      {rows.length>0?<div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>
            <th style={{textAlign:"left"}}>Batch</th>
            <th style={{textAlign:"right"}}>Verde plan (g)</th>
            <th style={{textAlign:"right"}}>Tostado estimado (g)</th>
            <th style={{textAlign:"left"}}>Tostado medido (g)</th>
            <th style={{textAlign:"right"}}>Merma real</th>
          </tr></thead>
          <tbody>{rows.map(row=>{
            const measured=Number(actuals[String(row.index)]||0);
            const good=measured>0&&measured<=row.green;
            return <tr key={row.index}>
              <td><strong>#{row.index+1}</strong></td>
              <td style={{textAlign:"right"}}>{number.format(row.green)}</td>
              <td style={{textAlign:"right"}}>{number.format(row.roasted)}</td>
              <td><input aria-label={"Peso tostado real batch "+(row.index+1)}
                  style={{width:"110px"}} type="number" min="0.1" max={row.green}
                  step="0.1" value={actuals[String(row.index)]||""}
                  onChange={e=>setActuals(old=>({...old,[String(row.index)]:e.target.value}))}
                  placeholder="Pesar"/></td>
              <td style={{textAlign:"right"}}>
                {good?((1-measured/row.green)*100).toFixed(2)+"%":"—"}
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>:<p className="muted">Ajusta los parámetros para generar las cargas.</p>}
      <p className="muted">Skywalker v1: una carga menor a la habitual puede cambiar la
        transferencia de calor y la inercia. Mantén el perfil técnico y la cata como
        criterios separados de estos cálculos de masa.</p>
    </section>

    <section className="card stack">
      <p className="eyebrow">03 · BATCHES QUE YA EXISTEN EN OPS</p>
      <h2>Confirmados para {date||"la fecha seleccionada"}</h2>
      <p className="muted">Estos registros vienen de la base de OPS, no de tu
        bitácora local ni de Loyverse. Si tuestas en QA, no descuentas la organización comercial.</p>
      <div className="grid">
        <div><strong>{confirmed.length}</strong> batches registrados</div>
        <div><strong>{peso(confirmedGreen)}</strong> verde registrado</div>
        <div><strong>{peso(confirmedRoasted)}</strong> tostado registrado</div>
      </div>
      {confirmed.length>0?confirmed.map(b=><div key={b.id} className="task">
        <div>
          <strong>{b.code}</strong>
          <div className="muted">{peso(b.greenG)} → {peso(b.roastedG)}
            {" · merma "}{b.lossPct.toFixed(2)}%
            {b.dtrPct==null?"":" · DTR "+b.dtrPct.toFixed(1)+"%"}
          </div>
          <div className="muted">{b.provider||"Manual"}
            {b.inventoryPosted?" · movimiento físico contabilizado":" · sin movimiento físico contabilizado"}
          </div>
        </div>
        <Link href={"/admin/roasting?batch="+b.id}>Ver batch</Link>
      </div>):<p className="muted">No hay batches confirmados con estos filtros.</p>}
    </section>

    <section className="card stack">
      <p className="eyebrow">04 · FLUJO DE HIBEAN</p>
      <h2>De la curva al registro oficial</h2>
      <p>
        Al terminar cada batch, expórtalo desde HiBean como JSON; usa
        «Importar JSON» para crear un borrador. En la pantalla siguiente
        verifica lote, peso verde, peso tostado, curva, FC, drop y
        <strong> existencia verde restante después del tueste</strong>.
      </p>
      <p className="status-warn">
        Confirmar un JSON actualiza el registro del batch y el saldo verde de HiBean
        confirmado en el módulo de tueste. No equivale por sí solo a contabilizar
        los movimientos físicos de café verde y tostado en Inventario OPS.
      </p>
      <Link href="/admin/roasting">Ver lotes, perfiles y tuestes registrados</Link>
    </section>
  </div>;
}
