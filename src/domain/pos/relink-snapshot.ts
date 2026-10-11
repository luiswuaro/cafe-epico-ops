/**
 * Reconecta sólo identidad de inventario para una receta ya servida.
 * Nunca sustituye el ticket por una receta actual diferente ni cambia precio.
 * Dosis idéntica tras normalizar unidades Loyverse (kg/L) a g/ml OPS.
 */
export type FrozenIngredient = Record<string,unknown>;
export type CurrentIngredient = {
 name:string; quantity:number; unitLabel:string;
 inventoryItemId?:string|null;inventoryLocationId?:string|null;
};
const normalize=(x:string)=>x.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .toUpperCase().replace(/\s+/g," ").trim();
const positive=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:null;};
function canonicalAmount(value:unknown,unit:unknown,targetUnit:string){
 const q=positive(value);
 if(q===null)return null;
 const label=String(unit??"").trim().toLowerCase();
 if(label===targetUnit.toLowerCase())return q;
 if((label==="peso/volumen"||label==="kg")&&targetUnit==="g")return q*1000;
 if((label==="peso/volumen"||label==="l")&&targetUnit==="ml")return q*1000;
 return null;
}
export function previewRelinkSnapshot(
 frozen:unknown,current:CurrentIngredient[],lineQuantity:number,
):{components:FrozenIngredient[];linked:{name:string;quantity:number;unit:string}[];issues:string[]}{
 if(!Array.isArray(frozen)||!Number.isSafeInteger(lineQuantity)||lineQuantity<=0)
   throw new Error("Los componentes o la cantidad del ticket son inválidos.");
 const linked:{name:string;quantity:number;unit:string}[]=[];
 const issues:string[]=[];
 const components:FrozenIngredient[]=frozen.map(raw=>{
   if(!raw||typeof raw!=="object"||Array.isArray(raw))
     throw new Error("El ticket contiene un componente inválido.");
   const source={...raw} as FrozenIngredient;
   if(source.inventoryItemId&&source.inventoryLocationId)return source;
   if(source.inventoryItemId||source.inventoryLocationId)
     throw new Error("La vinculación antigua de "+String(source.name)+" está incompleta.");
   if(source.inventoryPolicy==="COST_ONLY"||source.costOnlyCode==="WATER"||source.costOnlyCode==="ICE")
     return source;
   const name=String(source.name??"").trim();
   // El agua de preparación y el hielo propio nunca usan stock físico.
   if(normalize(name)==="AGUA"||normalize(name)==="HIELO")return source;
   const candidates=current.filter(c=>c.inventoryItemId&&c.inventoryLocationId
     &&normalize(c.name)===normalize(name));
   if(candidates.length===0)return source;
   if(candidates.length!==1){
     issues.push(name+": aparece repetido en la receta vigente; revisar manualmente.");
     return source;
   }
   const match=candidates[0];
   const q=canonicalAmount(source.quantity,source.unitLabel,match.unitLabel);
   const expected=positive(match.quantity);
   if(q===null||expected===null||Math.abs(q-expected*lineQuantity)>0.001){
     issues.push(name+": la cantidad o unidad cambió desde que se guardó la comanda.");
     return source;
   }
   const amount=Math.round(q*1000)/1000;
   linked.push({name,quantity:amount,unit:match.unitLabel});
   return {...source,
     inventoryItemId:match.inventoryItemId,
     inventoryLocationId:match.inventoryLocationId,
     variantExternalId:null,itemExternalId:null,
     quantity:amount,unitLabel:match.unitLabel,
   };
 });
 return {components,linked,issues};
}
