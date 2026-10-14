/** Reposición OPS, sin mezclar inventario Loyverse ni fabricar precios. */
export type NativePurchaseInput={
  stock:number; minimum:number|null; averageDaily:number;
  sampleDays:number;packageQuantity:number|null;unitCost:number|null;
};
export function nativePurchaseSuggestion(v:NativePurchaseInput){
  if(!Number.isFinite(v.stock))return null;
  const min=v.minimum!=null&&Number.isFinite(v.minimum)&&v.minimum>=0?v.minimum:null;
  const daily=v.sampleDays>=3&&Number.isFinite(v.averageDaily)&&v.averageDaily>0?v.averageDaily:0;
  // Sin mínimo ni demanda estadística verificable no generar compra ficticia.
  if(min===null&&daily===0)return null;
  const threshold=min??(daily*3);
  if(v.stock>threshold)return null;
  const target=Math.max(threshold,0)+daily*7;
  const shortfall=Math.max(0,target-v.stock);
  if(shortfall<=0)return null;
  const pack=v.packageQuantity!=null&&Number.isFinite(v.packageQuantity)&&v.packageQuantity>0
    ?v.packageQuantity:null;
  const packages=pack?Math.ceil(shortfall/pack):null;
  const quantity=pack&&packages?packages*pack:Math.ceil(shortfall*1000)/1000;
  const unitCost=v.unitCost!=null&&Number.isFinite(v.unitCost)&&v.unitCost>=0?v.unitCost:null;
  return {quantity,packages,daysCover:daily>0?Math.max(0,v.stock)/daily:null,
    estimatedCost:unitCost==null?null:Math.round(quantity*unitCost*100)/100};
}
