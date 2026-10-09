"use client";

import { useId, useMemo, useState } from "react";

export type RecipeEditorComponent = {
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
  ingredientOptions,
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

      <p className="status-warn">
        Importante: para ingredientes fraccionarios de Loyverse
        la cantidad editable está en kg (o L para leche deslactosada),
        NO en gramos ni mililitros. 18 g = 0.018 kg; 200 ml = 0.200 L.
        Cambiar sólo el texto de la unidad no realiza conversiones.
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
          <div className="recipe-component-head" aria-hidden="true">
            <span>Cantidad</span>
            <span>Unidad</span>
            <span>Ingrediente / insumo</span>
            <span />
          </div>

          <div className="recipe-component-list">
            {activeRows.map((row) => (
              <div className="recipe-component-row" key={row.key}>
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
                    onChange={(event) =>
                      updateRow(row.key, {
                        name: event.target.value,
                        // Al cambiar de ingrediente, nunca conservar la
                        // identidad Loyverse del ingrediente anterior.
                        variantExternalId: null,
                        itemExternalId: null,
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
