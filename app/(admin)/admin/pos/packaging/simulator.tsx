"use client";
import {useState} from "react";
import {calculatePaperBagPlan} from "@/src/domain/pos/paper-bag-packaging";
export function PackagingSimulator(){
 const [hojaldras,setHojaldras]=useState(5);
 const [croissants,setCroissants]=useState(1);
 const plan=calculatePaperBagPlan([
  {name:"Pan SOLO",category:"ALIMENTOS",serviceMode:"TAKEAWAY",quantity:hojaldras},
  {name:"CROISSANT JAMÓN Y QUESO",category:"ALIMENTOS",serviceMode:"TAKEAWAY",quantity:croissants},
 ]);
 return <div className="packaging-simulator">
  <div className="form-grid">
   <label>Pan SOLO · hojaldras<input type="number" min="0" max="99" step="1" value={hojaldras}
    onChange={e=>setHojaldras(Math.max(0,Math.min(99,Math.floor(Number(e.target.value)||0))))}/></label>
   <label>Croissants jamón/queso<input type="number" min="0" max="99" step="1" value={croissants}
    onChange={e=>setCroissants(Math.max(0,Math.min(99,Math.floor(Number(e.target.value)||0))))}/></label>
  </div>
  <p><strong>{plan.hojaldraBags}</strong> bolsa(s) para hojaldras +
    <strong> {plan.croissantBags}</strong> para croissants</p>
  <strong className="packaging-simulator-result">{plan.bags} bolsas de papel</strong>
  <small className="muted">Simulación sin movimientos de inventario.</small>
 </div>;
}
