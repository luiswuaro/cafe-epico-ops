import {getPosCatalog} from "@/src/application/pos/catalog";
import {projectBarRecipe,sortBarRecipes} from "@/src/domain/recipes/bar-recipe-projection";

/** ÚNICA fuente: el catálogo LIVE POS, el mismo que descuenta el inventario.
 * No usar el recetario Loyverse histórico para instrucciones del personal.
 */
export async function getEmployeePosRecipeBook(organizationId:string){
  const catalog=await getPosCatalog(organizationId);
  return sortBarRecipes(catalog.flatMap(item=>{
    const projected=projectBarRecipe(item);
    return projected?[projected]:[];
  }));
}
export async function getEmployeePosRecipe(organizationId:string,recipeId:string){
  const recipes=await getEmployeePosRecipeBook(organizationId);
  return recipes.find(item=>item.id===recipeId)??null;
}
