import {getLoyverseRecipeSource} from "@/src/application/loyverse/recipes";
import type {PosRecipeComponent} from "./catalog";

export type ExtraOption={id:string;label:string;price:number;maxQuantity:number;enabled:boolean;reason:string|null;components:PosRecipeComponent[]};

export async function getPosExtraCatalog(organizationId:string):Promise<ExtraOption[]> {
  const source=await getLoyverseRecipeSource(organizationId);
  return source.recipes.filter(r=>r.category.toUpperCase()==="EXTRAS" &&
    r.availableForSale && r.salePrice!==null && r.salePrice>0).map(r=>{
    const components:PosRecipeComponent[]=r.effectiveComponents.filter(c=>
      !/VASO|TAPA|POPOTE|SERVILLETA|MANGA|FAJILLA/i.test(c.sourceName)).map(c=>({
      name:c.sourceName,quantity:c.quantity,variantExternalId:c.variantExternalId,
      itemExternalId:c.itemExternalId,unitLabel:c.unitLabel,category:c.category,
    }));
    const swap=/CAMBIO DE LECHE/i.test(r.itemName);
    const missing=components.length===0 || components.some(c=>
      !c.itemExternalId || c.quantity<=0 || !Number.isFinite(c.quantity));
    const reason=swap?"Sustitución pendiente de configurar":
      missing?"Receta de consumo pendiente":null;
    return {id:r.externalId,label:r.itemName,price:Number(r.salePrice),
      maxQuantity:swap?1:2,enabled:reason===null,reason,components};
  }).sort((a,b)=>Number(b.enabled)-Number(a.enabled)||
    (a.label.includes("ESPRESSO")?-1:b.label.includes("ESPRESSO")?1:0)||
    a.label.localeCompare(b.label,"es"));
}
