import type {PosCatalogCategory,PosRecipeComponent} from "./catalog";
import type {ExtraOption} from "./extra-catalog";

export type ExtraRequest={id:string;quantity:number};
export type ExtraSnapshot={
  id:string;label:string;quantity:number;unitPrice:number;
  components:PosRecipeComponent[];
};
export type ExtraProduct={name:string;category:PosCatalogCategory};

const money=(n:number)=>"$"+n.toFixed(2);
/** El navegador sólo elige ID y cantidad; precio e ingredientes proceden de Loyverse. */
export function priceExtras(raw:ExtraRequest[]|undefined,product:ExtraProduct,
  catalog:ExtraOption[]):{unitPrice:number;extras:ExtraSnapshot[];components:PosRecipeComponent[]}{
  if(!raw?.length)return {unitPrice:0,extras:[],components:[]};
  if(product.category==="ALIMENTOS")throw new Error("Los extras sólo aplican a bebidas.");
  if(raw.length>20 || raw.length>catalog.length)throw new Error("Demasiados modificadores.");
  const seen=new Set<string>();
  const extras:ExtraSnapshot[]=[];
  const components:PosRecipeComponent[]=[];
  let cents=0;
  for(const request of raw){
    const option=catalog.find(x=>x.id===request.id);
    if(!option||!option.enabled||seen.has(request.id)||
      !Number.isInteger(request.quantity)||request.quantity<1||
      request.quantity>option.maxQuantity)throw new Error("Extra sin receta válida o cantidad incorrecta.");
    seen.add(request.id);
    const expanded=option.components.map(c=>({...c,quantity:Number((c.quantity*request.quantity).toFixed(6))}));
    extras.push({id:option.id,label:option.label,quantity:request.quantity,
      unitPrice:option.price,components:expanded});
    components.push(...expanded);
    cents+=Math.round(option.price*100)*request.quantity;
  }
  return {unitPrice:cents/100,extras,components};
}

export function readExtraSnapshots(expected:unknown):ExtraSnapshot[]{
  if(!expected||typeof expected!=="object"||Array.isArray(expected))return [];
  const raw=(expected as Record<string,unknown>).extras;
  if(!Array.isArray(raw))return [];
  return raw.flatMap(value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))return [];
    const obj=value as Record<string,unknown>;
    const qty=Number(obj.quantity);
    const price=Number(obj.unitPrice);
    const label=typeof obj.label==="string"?obj.label.slice(0,90):
      obj.id==="ESPRESSO_SHOT"?"Espresso extra":"";
    if(!label||!Number.isInteger(qty)||qty<1||qty>20||
      !Number.isFinite(price)||price<0)return [];
    return [{id:String(obj.id||""),label,quantity:qty,unitPrice:price,components:[]}];
  });
}
export function extraLabels(expected:unknown,{showPrices=false}:{showPrices?:boolean}={}):string[]{
  return readExtraSnapshots(expected).map(e=>
    "+ "+e.quantity+"× "+e.label+(showPrices?" ("+money(e.quantity*e.unitPrice)+")":""));
}
export function preparationNote(note:string|null|undefined,expected:unknown):string|null{
  const all=[...extraLabels(expected),note?.trim()||""].filter(Boolean);
  return all.length?all.join(" · "):null;
}
