import type {PosRecipeComponent} from "@/src/application/pos/catalog";
import {isCostOnlyComponent} from "@/src/application/pos/component-policy";
import {type OperationalRecipeCategory,operationalRecipeCategoryOrder} from "@/src/domain/recipes/operational";

export type BarServiceMode="DINE_IN"|"TAKEAWAY";
export type BarExtractionType="RISTRETTO"|"ESPRESSO"|"LUNGO";
export type BarCoffeeExtraction={
  type:BarExtractionType;
  label:string;
  portions:1;
  doseG:18;
  yieldMinG:number;
  yieldMaxG:number;
  secondsMin:number;
  secondsMax:number;
  stockQuantityG:number;
  stockIngredientName:string;
};
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
    service:BarRecipeLine[];costOnly:BarRecipeLine[];coffeeExtraction:BarCoffeeExtraction|null}>;
  components:BarRecipeLine[];
};

const disposablePattern=/\b(VASO|TAPA|MANGA|FAJILLA|SERVILLETA|POPOTE|PAJILLA|BOLSA|CUBIERTO|CHAROLA)\b/i;
const espressoHopperItemId="00000000-0000-4000-8000-000000000060";
const normalize=(name:string)=>name.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/\s+/g," ").trim();
/** Sólo traduce a instrucción una dosis nominal registrada de 20 g de tolva;
 * nunca cambia el componente que recibe la salida de inventario.
 */
function isHopperStockComponent(component:PosRecipeComponent){
  if(component.costOnlyCode || component.quantity!==20 || normalize(component.unitLabel)!=="G")return false;
  if(component.inventoryItemId===espressoHopperItemId)return true;
  const name=normalize(component.name);
  return name==="CAFE ESPRESSO EN GRANO" || name==="CAFE EN GRANO PARA TOLVA" ||
    name==="CAFE PARA TOLVA";
}
export function extractionForCoffeeDrink(name:string):BarExtractionType {
  const product=normalize(name);
  if(/^FLAT WHITE(?: |$)/.test(product))return "RISTRETTO";
  if(/^AMERICANO(?: (?:FRIO|CALIENTE))?$/.test(product))return "LUNGO";
  return "ESPRESSO";
}
function extractionSpec(type:BarExtractionType,coffee:PosRecipeComponent):BarCoffeeExtraction{
  const params={
    RISTRETTO:{label:"Ristretto doble",yieldMinG:18,yieldMaxG:27,secondsMin:15,secondsMax:25},
    ESPRESSO:{label:"Espresso doble",yieldMinG:34,yieldMaxG:38,secondsMin:22,secondsMax:35},
    LUNGO:{label:"Lungo doble",yieldMinG:43,yieldMaxG:47,secondsMin:30,secondsMax:40},
  }[type];
  return {type,...params,portions:1,doseG:18,stockQuantityG:coffee.quantity,
    stockIngredientName:coffee.name};
}
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
    const projection=projectBarComponents(source.components);
    const matched=source.components.filter(isHopperStockComponent);
    if(matched.length!==1)return {...projection,configured:source.configured,coffeeExtraction:null};
    const coffee=matched[0];
    // El café se presenta como una operación de extracción, no como 20 g
    // vertidos en la canasta. Los 20 g siguen intactos en Catálogo POS.
    return {...projection,configured:source.configured,
      ingredients:projection.ingredients.filter(line=>!(line.name===coffee.name &&
        line.quantity===coffee.quantity && line.unit===coffee.unitLabel &&
        line.inventoryItemId===(coffee.inventoryItemId??null))),
      coffeeExtraction:extractionSpec(extractionForCoffeeDrink(item.name),coffee)};
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
