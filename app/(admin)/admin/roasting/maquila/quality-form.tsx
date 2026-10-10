"use client";

import { useMemo, useState } from "react";
import { createContractBatch } from "./actions";
import { defectTypes } from "@/src/application/roasting/contract-utils";

type Row={key:number;type:string;severity:"PRIMARY"|"SECONDARY"|"OTHER";count:string;grams:string};
const primary=new Set(["Negro completo","Agrio completo","Materia extraña"]);
const newRow=(key:number):Row=>({key,type:"Inmaduro",severity:"SECONDARY",count:"1",grams:"0"});

export function ContractBatchForm({lotId,remainingGreenG,sequence}:{
  lotId:string;remainingGreenG:number;sequence:number;
}){
  const [rows,setRows]=useState<Row[]>([]);
  const [sample,setSample]=useState("");
  const [green,setGreen]=useState("400");
  const [roasted,setRoasted]=useState("");
  const [nextId,setNextId]=useState(1);
  const defects=useMemo(()=>rows.map(row=>({
    type:row.type,severity:row.severity,count:Number(row.count),grams:Number(row.grams),
  })),[rows]);
  const totalDefectG=defects.reduce((n,d)=>n+(Number.isFinite(d.grams)?d.grams:0),0);
  const sampleG=sample?Number(sample):null;
  const greenG=Number(green),roastedG=Number(roasted);
  const pct=sampleG&&sampleG>0?totalDefectG/sampleG*100:null;
  const invalid=(!Number.isFinite(greenG)||greenG<=0||greenG>remainingGreenG||
    !Number.isFinite(roastedG)||roastedG<=0||roastedG>greenG||
    rows.some(r=>!Number.isInteger(Number(r.count))||Number(r.count)<1||
      !Number.isFinite(Number(r.grams))||Number(r.grams)<0)||
    (rows.length>0&&(!sampleG||sampleG<=0))||
    (sampleG!=null&&sampleG>0&&totalDefectG>sampleG));

  return <form action={createContractBatch} className="stack ops-contract-batch-form">
    <input type="hidden" name="lotId" value={lotId}/>
    <input type="hidden" name="defectsJson" value={JSON.stringify(defects)}/>
    <div className="ops-contract-fields">
      <label>Código de batch
        <input name="batchCode" required maxLength={100}
          placeholder={"Ej. MQ-"+String(sequence).padStart(3,"0")}/>
      </label>
      <label>Fecha de tueste
        <input name="roastedAt" type="datetime-local"
          aria-label="Fecha y hora del batch"/>
      </label>
      <label>Verde procesado (g)
        <input name="greenG" type="number" required min=".01"
          max={remainingGreenG} step=".01" value={green}
          onChange={e=>setGreen(e.target.value)}/>
      </label>
      <label>Tostado obtenido (g)
        <input name="roastedG" type="number" required min=".01"
          max={greenG||undefined} step=".01" value={roasted}
          onChange={e=>setRoasted(e.target.value)}
          placeholder="Peso después de enfriar"/>
      </label>
      <label>Perfil / equipo
        <input name="profile" maxLength={180}
          placeholder="Ej. Skywalker V1 · Omni"/>
      </label>
      <label>Tiempo total (s)
        <input name="durationS" type="number" min="1" step="1" placeholder="Ej. 520"/>
      </label>
      <label>Temperatura FC (°C)
        <input name="firstCrackC" type="number" min="0" max="350" step=".01" placeholder="Si se midió"/>
      </label>
      <label>Drop (°C)
        <input name="dropC" type="number" min="0" max="350" step=".01" placeholder="Si se midió"/>
      </label>
      <label>DTR real (%)
        <input name="dtrPct" type="number" min="0" max="100" step=".001" placeholder="Si se calculó"/>
      </label>
    </div>
    <details className="ops-contract-qc" open>
      <summary>Inspección de defectos · muestra pesada</summary>
      <p className="muted">
        Indica el peso de la muestra verde inspeccionada y registra los defectos.
        El porcentaje se calcula por <strong>masa de defectos / masa de la muestra</strong>.
        No equivale automáticamente al puntaje SCA de defectos.
      </p>
      <label>Peso de muestra verde (g)
        <input name="greenDefectSampleG" type="number" min=".01" max="10000" step=".01"
          placeholder="Ej. 100" value={sample} onChange={e=>setSample(e.target.value)}/>
      </label>
      <div className="ops-contract-defects">
        {rows.map((row,index)=><div key={row.key} className="ops-contract-defect-row">
          <label>Tipo
            <select value={row.type} onChange={e=>{
              const type=e.target.value;
              setRows(list=>list.map(r=>r.key===row.key?{
                ...r,type,severity:primary.has(type)?"PRIMARY":"SECONDARY",
              }:r));
            }}>
              {defectTypes.map(name=><option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>Clasificación
            <select value={row.severity} onChange={e=>setRows(list=>
              list.map(r=>r.key===row.key?{...r,severity:e.target.value as Row["severity"]}:r))}>
              <option value="PRIMARY">Primario</option>
              <option value="SECONDARY">Secundario</option>
              <option value="OTHER">Otro</option>
            </select>
          </label>
          <label>Piezas
            <input type="number" min="1" max="10000" step="1" value={row.count}
              onChange={e=>setRows(list=>list.map(r=>r.key===row.key?{...r,count:e.target.value}:r))}/>
          </label>
          <label>Masa (g)
            <input type="number" min="0" max="10000" step=".01" value={row.grams}
              onChange={e=>setRows(list=>list.map(r=>r.key===row.key?{...r,grams:e.target.value}:r))}/>
          </label>
          <button type="button" className="ops-action-soft"
            onClick={()=>setRows(list=>list.filter(r=>r.key!==row.key))}
            aria-label={"Eliminar defecto "+(index+1)}>Eliminar</button>
        </div>)}
      </div>
      {rows.length<24&&<button type="button" className="ops-action-soft"
        onClick={()=>{
          setRows(list=>[...list,newRow(nextId)]);
          setNextId(id=>id+1);
        }}>+ Añadir defecto</button>}
      <p className="ops-contract-result">
        {sampleG&&sampleG>0
          ?`Inspeccionados ${sampleG.toLocaleString("es-MX")} g ·
              defectos ${totalDefectG.toFixed(2)} g ·
              ${(pct??0).toFixed(2)}% por masa`
          :"Sin muestra evaluada: el reporte indicará «No evaluado»."}
      </p>
      {totalDefectG>(sampleG??0)&&<p className="status-warn" role="alert">
        La masa total de defectos no puede superar la muestra.
      </p>}
    </details>
    <label>Observaciones de tueste / QC
      <textarea name="qualityNotes" rows={2} maxLength={1200}
        placeholder="Desviaciones, scorching, tipping, uniformidad, desarrollo…"/>
    </label>
    <label>Notas sensoriales (si se realizó cata)
      <textarea name="sensoryNotes" rows={2} maxLength={1200}
        placeholder="Acidez, dulzor, cuerpo, aroma, posgusto; no inventar sin cata"/>
    </label>
    <p className="muted">Disponible para procesar: <strong>{remainingGreenG.toLocaleString("es-MX")} g</strong>.
      Cada batch consumirá de este inventario de maquila, no del café propio de OPS.</p>
    <button type="submit" disabled={invalid||!green||!roasted}>
      Registrar batch y descontar verde del cliente
    </button>
  </form>;
}
