"use client";

import { useId, useMemo, useState } from "react";
import type {NativeRecipeOption,LegacyRecipeMapping} from "@/src/application/pos/native-recipe-options";
import {costOnlyComponentCode,type CostOnlyCode} from "@/src/application/pos/component-policy";

export type RecipeEditorComponent = {
  inventoryItemId?:string|null;
  inventoryLocationId?:string|null;
  costOnlyCode?:CostOnlyCode|null;
  variantExternalId: string | null;
  itemExternalId: string | null;
  name: string;
  quantity: number;
  unitLabel: string;
  category: string | null;
};

type EditorRow = RecipeEditorComponent & { key: string };

type Props = {
  dineIn: RecipeEditorComponent[];
  takeaway: RecipeEditorComponent[];
  ingredientOptions: string[];
  inventoryOptions:NativeRecipeOption[];
  legacyMappings:LegacyRecipeMapping[];
};

function rowsFrom(
  prefix: string,
  components: RecipeEditorComponent[],
): EditorRow[] {
  if (components.length === 0) {
    return [{
      key: prefix + "-0",
      variantExternalId: null,
      itemExternalId: null,
      name: "",
      quantity: 1,
      unitLabel: "pz",
      category: null,
    }];
  }

  return components.map((component, index) => ({
    ...component,
    key: prefix + "-" + index,
  }));
}

function equivalent(
  left: RecipeEditorComponent[],
  right: RecipeEditorComponent[],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toPayload(rows: EditorRow[]) {
  return rows
    .filter((row) => row.name.trim() && Number(row.quantity) > 0)
    .map(({ key: _key, ...row }) => ({
      ...row,
      name: row.name.trim(),
      unitLabel: row.unitLabel.trim() || "u.",
      quantity: Number(row.quantity),
    }));
}

export function RecipeServiceEditor({
  dineIn,
  takeaway,
  ingredientOptions,inventoryOptions,legacyMappings,
}: Props) {
  const editorId = useId().replace(/:/g, "");
  const unitListId = "recipe-units-" + editorId;
  const ingredientListId = "recipe-ingredients-" + editorId;

  const [activeMode, setActiveMode] =
    useState<"DINE_IN" | "TAKEAWAY">("DINE_IN");
  const [dineRows, setDineRows] = useState<EditorRow[]>(() =>
    rowsFrom("dine", dineIn),
  );
  const [takeRows, setTakeRows] = useState<EditorRow[]>(() =>
    rowsFrom("take", takeaway.length ? takeaway : dineIn),
  );
  const [sameForTakeaway, setSameForTakeaway] = useState(() =>
    equivalent(dineIn, takeaway.length ? takeaway : dineIn),
  );

  const activeRows =
    activeMode === "DINE_IN"
      ? dineRows
      : sameForTakeaway
        ? dineRows
        : takeRows;

  const setRows =
    activeMode === "DINE_IN" ? setDineRows : setTakeRows;

  const dinePayload = useMemo(() => toPayload(dineRows), [dineRows]);
  const takeawayPayload = useMemo(
    () => (sameForTakeaway ? dinePayload : toPayload(takeRows)),
    [dinePayload, sameForTakeaway, takeRows],
  );

  function updateRow(
    key: string,
    patch: Partial<RecipeEditorComponent>,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, ...patch } : row,
      ),
    );
  }

  const legacyByVariant=new Map(legacyMappings.map(m=>[m.variantExternalId,m]));
  const nativeByLocation=new Map(inventoryOptions.map(o=>[o.inventoryItemId+"|"+o.locationId,o]));
  function asNonInventory(row:EditorRow,code:CostOnlyCode):Partial<EditorRow>{
    const source=row.unitLabel.trim().toLowerCase();
    const multiplier=(source==="peso/volumen"||source==="kg")?1000:1;
    return {inventoryItemId:null,inventoryLocationId:null,
      variantExternalId:null,itemExternalId:null,costOnlyCode:code,
      name:code==="WATER"?"AGUA":"HIELO",unitLabel:"g",category:"COST_ONLY",
      quantity:Number((row.quantity*multiplier).toFixed(3))};
  }
  function chooseNative(row:EditorRow,value:string){
    if(value==="COST:WATER"||value==="COST:ICE"){
      updateRow(row.key,asNonInventory(row,value==="COST:WATER"?"WATER":"ICE"));
      return;
    }
    const selected=nativeByLocation.get(value);
    if(!selected)return;
    const legacy=row.variantExternalId?legacyByVariant.get(row.variantExternalId):undefined;
    const shouldConvert=row.unitLabel.toLowerCase()==="peso/volumen";
    const factor=legacy&&legacy.inventoryItemId===selected.inventoryItemId&&legacy.locationId===selected.locationId
      ?legacy.factor:shouldConvert?1000:1;
    updateRow(row.key,{
      inventoryItemId:selected.inventoryItemId,inventoryLocationId:selected.locationId,
      costOnlyCode:null,variantExternalId:null,itemExternalId:null,
      name:selected.name,unitLabel:selected.unit,category:"OPS",
      quantity:Number((row.quantity*factor).toFixed(3)),
    });
  }
  function migrateCurrent(){
    const migrate=(rows:EditorRow[])=>rows.map(row=>{
      if(row.inventoryItemId&&row.inventoryLocationId)return row;
      const policy=costOnlyComponentCode(row);
      if(policy)return {...row,...asNonInventory(row,policy)};
      const legacy=row.variantExternalId?legacyByVariant.get(row.variantExternalId):undefined;
      const selected=legacy&&nativeByLocation.get(legacy.inventoryItemId+"|"+legacy.locationId);
      if(!selected||!legacy)return row;
      return {...row,inventoryItemId:selected.inventoryItemId,
        inventoryLocationId:selected.locationId,variantExternalId:null,
        itemExternalId:null,name:selected.name,unitLabel:selected.unit,
        category:"OPS",quantity:Number((row.quantity*legacy.factor).toFixed(3))};
    });
    if(activeMode==="DINE_IN")setDineRows(current=>migrate(current));
    else setTakeRows(current=>migrate(current));
  }
  function addRow() {
    setRows((current) => [
      ...current,
      {
        key:
          activeMode.toLowerCase() +
          "-" +
          globalThis.crypto.randomUUID(),
        variantExternalId: null,
        itemExternalId: null,
        name: "",
        quantity: 1,
        unitLabel: "pz",
        category: null,
      },
    ]);
  }

  function removeRow(key: string) {
    setRows((current) => {
      const next = current.filter((row) => row.key !== key);
      return next.length
        ? next
        : rowsFrom(activeMode.toLowerCase(), []);
    });
  }

  function customizeTakeaway() {
    setTakeRows(
      dineRows.map((row, index) => ({
        ...row,
        key: "take-copy-" + index,
      })),
    );
    setSameForTakeaway(false);
    setActiveMode("TAKEAWAY");
  }

  return (
    <div className="recipe-visual-editor">
      <input
        type="hidden"
        name="dineInRecipeJson"
        value={JSON.stringify({ components: dinePayload })}
      />
      <input
        type="hidden"
        name="takeawayRecipeJson"
        value={JSON.stringify({ components: takeawayPayload })}
      />

      <p className="muted">
        Recetas heredadas: las cantidades con unidad <strong>peso/volumen</strong> aún están
        en kg o L (por ejemplo, 0.018 = 18 g). Elige un insumo OPS o pulsa
        <strong> Vincular automáticamente </strong> para convertirlas a g, ml o pz.
        Antes de guardar, comprueba el resultado de cada ingrediente.
      </p>
      <div className="recipe-service-tabs" role="tablist">
        <button
          type="button"
          className={activeMode === "DINE_IN" ? "active" : ""}
          onClick={() => setActiveMode("DINE_IN")}
        >
          Aquí
        </button>
        <button
          type="button"
          className={activeMode === "TAKEAWAY" ? "active" : ""}
          onClick={() => setActiveMode("TAKEAWAY")}
        >
          Para llevar
        </button>
      </div>

      {activeMode === "TAKEAWAY" && sameForTakeaway ? (
        <div className="recipe-inherit-card">
          <strong>Usa la misma receta que “Aquí”.</strong>
          <span className="muted">
            Sólo crea una variante cuando el empaque o algún insumo cambie.
          </span>
          <button type="button" onClick={customizeTakeaway}>
            Personalizar para llevar
          </button>
        </div>
      ) : (
        <>
          <p className="muted">
            <strong>Inventario OPS:</strong> selecciona insumos físicos. Las cantidades se capturan
            en g, ml o pz; el inventario histórico no se modifica al editar.
          </p>
          <button type="button" onClick={migrateCurrent}>Vincular automáticamente insumos antiguos a OPS</button>
          <div className="recipe-component-head" aria-hidden="true">
            <span>Cantidad</span>
            <span>Unidad</span>
            <span>Ingrediente / insumo</span>
            <span />
          </div>

          <div className="recipe-component-list">
            {activeRows.map((row) => (
              <div className="recipe-component-row" key={row.key}>
                <label style={{gridColumn:"1 / -1"}}>
                  <span className="mobile-field-label">Insumo del inventario OPS</span>
                  <select value={row.inventoryItemId&&row.inventoryLocationId
                    ?row.inventoryItemId+"|"+row.inventoryLocationId
                    :row.costOnlyCode?"COST:"+row.costOnlyCode:""}
                    onChange={e=>chooseNative(row,e.target.value)}>
                    <option value="">Sin vincular · seleccionar insumo OPS</option>
                    <option value="COST:WATER">AGUA PURIFICADA · Solo costo (g), SIN inventario</option>
                    <option value="COST:ICE">HIELO PROPIO · Solo costo (g), SIN inventario</option>
                    {inventoryOptions.map(o=><option
                      key={o.inventoryItemId+"|"+o.locationId}
                      value={o.inventoryItemId+"|"+o.locationId}>
                      {o.name} · {o.locationName} · {o.unit} · saldo {o.available} {o.unit}
                    </option>)}
                  </select>
                  {row.inventoryItemId
                    ?<small className="status-ok">Vinculado al inventario OPS</small>
                    :row.costOnlyCode?<small className="status-ok">Solo costo: sin equivalencia, sin descuento de existencias</small>
                    :costOnlyComponentCode(row)?<small className="status-ok">Agua/hielo heredado: ya es solo costo; puedes convertirlo a OPS</small>
                    :<small className="status-warn">Receta heredada, pendiente de vincular a OPS</small>}
                </label>
                <label>
                  <span className="mobile-field-label">Cantidad</span>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={row.quantity}
                    onChange={(event) =>
                      updateRow(row.key, {
                        quantity: Number(event.target.value),
                      })
                    }
                    required
                  />
                </label>

                <label>
                  <span className="mobile-field-label">Unidad</span>
                  <input
                    list={unitListId}
                    value={row.unitLabel}
                    readOnly={Boolean(row.inventoryItemId||row.costOnlyCode)}
                    onChange={(event) =>
                      updateRow(row.key, {
                        unitLabel: event.target.value,
                      })
                    }
                    required
                  />
                </label>

                <label>
                  <span className="mobile-field-label">Ingrediente</span>
                  <input
                    list={ingredientListId}
                    value={row.name}
                    readOnly={Boolean(row.inventoryItemId||row.costOnlyCode)}
                    onChange={(event) =>
                      updateRow(row.key, {
                        name: event.target.value,
                        // Al cambiar de ingrediente, nunca conservar la
                        // identidad Loyverse del ingrediente anterior.
                        variantExternalId: null,
                        itemExternalId: null,
                        costOnlyCode:null,
                      })
                    }
                    placeholder="Ej. Leche deslactosada"
                    required
                  />
                </label>

                {row.unitLabel.trim().toLowerCase() === "peso/volumen" && (
                  <p className="muted" style={{margin:0,gridColumn:"1 / -1"}}>
                    Equivalente aproximado en barra:{" "}
                    <strong>{(row.quantity * 1000).toLocaleString("es-MX", {
                      maximumFractionDigits: 3,
                    })} {row.name.trim().toUpperCase()==="LECHE DESLACTOSADA"?"ml":"g"}</strong>.
                    La cantidad editable sigue expresada en kg o L de Loyverse;
                    por ejemplo, 20 g = 0.020 kg y 240 ml = 0.240 L.
                  </p>
                )}

                <button
                  type="button"
                  className="recipe-remove-row"
                  onClick={() => removeRow(row.key)}
                  aria-label={"Quitar " + (row.name || "ingrediente")}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="recipe-add-row"
            onClick={addRow}
          >
            + Agregar insumo
          </button>

          {activeMode === "TAKEAWAY" && (
            <button
              type="button"
              className="recipe-link-button"
              onClick={() => {
                setSameForTakeaway(true);
                setActiveMode("DINE_IN");
              }}
            >
              Volver a usar la misma receta que “Aquí”
            </button>
          )}
        </>
      )}

      <datalist id={unitListId}>
        <option value="g" />
        <option value="ml" />
        <option value="pz" />
        <option value="oz" />
        <option value="u." />
        <option value="peso/volumen" />
      </datalist>

      <datalist id={ingredientListId}>
        {ingredientOptions.map((ingredient) => (
          <option key={ingredient} value={ingredient} />
        ))}
      </datalist>
    </div>
  );
}
