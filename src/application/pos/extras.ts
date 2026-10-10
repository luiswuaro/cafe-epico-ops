import type {PosCatalogCategory,PosRecipeComponent,PosServiceMode} from "./catalog";

export const POS_EXTRAS = [
  {id:"ESPRESSO_SHOT",label:"Espresso extra",price:10,maxQuantity:2},
] as const;

export type ExtraId=typeof POS_EXTRAS[number]["id"];
export type ExtraRequest={id:ExtraId;quantity:number};
export type ExtraSnapshot={
  id:ExtraId;label:string;quantity:number;unitPrice:number;
  components:PosRecipeComponent[];
};
export type ExtraProduct={
  name:string;category:PosCatalogCategory;
  serviceRecipes:Record<PosServiceMode,{components:PosRecipeComponent[]}>;
};

const money=(n:number)=>"$"+n.toFixed(2);
const normalize=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().trim();

/** Los extras son opciones cerradas: nunca aceptar precios/insumos del navegador. */
export function priceExtras(raw:ExtraRequest[]|undefined,product:ExtraProduct,
  catalog:ExtraProduct[]):{unitPrice:number;extras:ExtraSnapshot[];components:PosRecipeComponent[]}{
  if(!raw?.length)return {unitPrice:0,extras:[],components:[]};
  if(product.category==="ALIMENTOS")throw new Error("Los extras de espresso sólo aplican a bebidas.");
  if(raw.length>POS_EXTRAS.length)throw new Error("Demasiados modificadores.");
  const seen=new Set<string>();
  let unitPrice=0;
  const extras:ExtraSnapshot[]=[];
  const components:PosRecipeComponent[]=[];
  for(const request of raw){
    const option=POS_EXTRAS.find(x=>x.id===request.id);
    if(!option||seen.has(request.id)||!Number.isInteger(request.quantity)||
      request.quantity<1||request.quantity>option.maxQuantity)
      throw new Error("Modificador inválido o repetido.");
    seen.add(request.id);
    // En el futuro, cada extra del catálogo declarará su propia receta.
    // Para este extra se utiliza exactamente la receta activa de espresso
    // sin un segundo vaso/tapa/servilleta, conservando variedad e insumos.
    const source=catalog.find(p=>normalize(p.name)==="ESPRESSO") ??
      catalog.find(p=>/^ESPRESSO (DOBLE|2X)$/.test(normalize(p.name)));
    if(!source)throw new Error("No se encontró la receta de Espresso para el extra.");
    const recipe=source.serviceRecipes.DINE_IN.components.filter(c=>
      !/VASO|TAPA|MANGA|FAJILLA|POPOTE|PAJILLA|SERVILLETA|BOLSA|AGITADOR|PORTAVASO/i.test(c.name));
    if(recipe.length===0||recipe.some(c=>!c.variantExternalId||!(c.quantity>0)))
      throw new Error("La receta de espresso extra necesita ingredientes e inventario vinculados.");
    const copied=recipe.map(c=>({...c,quantity:Number((c.quantity*request.quantity).toFixed(6))}));
    extras.push({id:option.id,label:option.label,quantity:request.quantity,
      unitPrice:option.price,components:copied});
    components.push(...copied);
    unitPrice+=option.price*request.quantity;
  }
  return {unitPrice,extras,components};
}

export function readExtraSnapshots(expected:unknown):ExtraSnapshot[]{
  if(!expected||typeof expected!=="object"||Array.isArray(expected))return [];
  const raw=(expected as Record<string,unknown>).extras;
  if(!Array.isArray(raw))return [];
  return raw.flatMap(value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))return [];
    const obj=value as Record<string,unknown>;
    const option=POS_EXTRAS.find(x=>x.id===obj.id);
    const qty=Number(obj.quantity);
    if(!option||!Number.isInteger(qty)||qty<1||qty>option.maxQuantity)return [];
    return [{id:option.id,label:option.label,quantity:qty,
      unitPrice:Number.isFinite(Number(obj.unitPrice))?Number(obj.unitPrice):option.price,
      components:[]}];
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
