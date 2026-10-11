import type {PosRecipeComponent} from "@/src/application/pos/catalog";
import {isCostOnlyComponent} from "@/src/application/pos/component-policy";
import {type OperationalRecipeCategory,operationalRecipeCategoryOrder} from "@/src/domain/recipes/operational";

export type BarServiceMode="DINE_IN"|"TAKEAWAY";
export type BarRecipeLine={
  name:string;quantity:number;unit:string;
  isDisposable:boolean;isCostOnly:boolean;
  /** Only the OPS inventory/costing recipe determines quantity. */
  inventoryItemId:string|null;
};
export type BarRecipe={
  id:string;name:string;category:OperationalRecipeCategory;
  sourceType:"MANUAL"|"LOYVERSE";
  serviceRecipes:Record<BarServiceMode,{configured:boolean;ingredients:BarRecipeLine[];
    service:BarRecipeLine[];costOnly:BarRecipeLine[]}>;
  components:BarRecipeLine[];
};

const disposablePattern=/\b(VASO|TAPA|MANGA|FAJILLA|SERVILLETA|POPOTE|PAJILLA|BOLSA|CUBIERTO|CHAROLA)\b/i;
export function projectBarComponents(components:PosRecipeComponent[]){
  const mapped:BarRecipeLine[]=components.map(c=>({
    name:c.name,quantity:c.quantity,unit:c.unitLabel,
    isDisposable:disposablePattern.test(c.name),
    isCostOnly:isCostOnlyComponent(c),
    inventoryItemId:c.inventoryItemId??null,
  }));
  return {
    ingredients:mapped.filter(c=>!c.isDisposable&&(!c.isCostOnly||/^(HIELO|ICE)$/i.test(c.name.trim()))),
    service:mapped.filter(c=>c.isDisposable),
    costOnly:mapped.filter(c=>c.isCostOnly&&!/^(HIELO|ICE)$/i.test(c.name.trim())),
  };
}
export function projectBarRecipe(item:{
  id:string;name:string;category:string;sourceType:"MANUAL"|"LOYVERSE";
  serviceRecipes:Record<BarServiceMode,{configured:boolean;components:PosRecipeComponent[]}>;
}):BarRecipe|null{
  if(!(["CALIENTES","FRÍAS","ALIMENTOS"] as string[]).includes(item.category))return null;
  const build=(mode:BarServiceMode)=>{
    const source=item.serviceRecipes[mode];
    return {configured:source.configured,...projectBarComponents(source.components)};
  };
  const serviceRecipes={DINE_IN:build("DINE_IN"),TAKEAWAY:build("TAKEAWAY")};
  return {
    id:item.id,name:item.name,category:item.category as OperationalRecipeCategory,
    sourceType:item.sourceType,serviceRecipes,
    components:serviceRecipes.DINE_IN.ingredients,
  };
}
export function sortBarRecipes<T extends {category:OperationalRecipeCategory;name:string}>(items:T[]){
  return [...items].sort((a,b)=>operationalRecipeCategoryOrder(a.category)-
    operationalRecipeCategoryOrder(b.category)||a.name.localeCompare(b.name,"es-MX"));
}
