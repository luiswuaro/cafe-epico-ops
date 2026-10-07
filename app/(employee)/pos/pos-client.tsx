"use client";

import { useMemo, useState } from "react";
import { createShadowSale } from "./actions";

type CatalogItem = {
  id: string;
  name: string;
  category: "CALIENTES" | "FRÍAS" | "ALIMENTOS";
  price: number;
};

type Props = {
  catalog: CatalogItem[];
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export function PosClient({ catalog }: Props) {
  const [category, setCategory] = useState<"TODAS" | CatalogItem["category"]>(
    "CALIENTES",
  );
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [serviceMode, setServiceMode] =
    useState<"DINE_IN" | "TAKEAWAY">("DINE_IN");
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es-MX");
    return catalog.filter((item) => {
      const categoryOk = category === "TODAS" || item.category === category;
      const queryOk = !q || item.name.toLocaleLowerCase("es-MX").includes(q);
      return categoryOk && queryOk;
    });
  }, [catalog, category, query]);

  const cartLines = catalog
    .filter((item) => (cart[item.id] ?? 0) > 0)
    .map((item) => ({ ...item, quantity: cart[item.id] }));

  const total = cartLines.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );

  const add = (id: string) =>
    setCart((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));

  const change = (id: string, delta: number) =>
    setCart((current) => {
      const next = Math.max(0, (current[id] ?? 0) + delta);
      const copy = { ...current };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });

  return (
    <div className="pos-layout">
      <section className="pos-catalog">
        <div className="card pos-toolbar">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar bebida o alimento..."
            aria-label="Buscar producto"
          />
          <div className="pos-category-tabs">
            {(["TODAS", "CALIENTES", "FRÍAS", "ALIMENTOS"] as const).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  className={category === value ? "active" : ""}
                  onClick={() => setCategory(value)}
                >
                  {value === "FRÍAS"
                    ? "Frías"
                    : value === "CALIENTES"
                      ? "Calientes"
                      : value === "ALIMENTOS"
                        ? "Alimentos"
                        : "Todas"}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="pos-product-grid">
          {visible.map((item) => (
            <button
              type="button"
              className="pos-product-card"
              key={item.id}
              onClick={() => add(item.id)}
            >
              <span className="eyebrow">{item.category}</span>
              <strong>{item.name}</strong>
              <span>{money.format(item.price)}</span>
              {(cart[item.id] ?? 0) > 0 && (
                <span className="pos-product-qty">{cart[item.id]}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <aside className="card pos-cart">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ORDEN ESPEJO</p>
            <h2>Cuenta</h2>
          </div>
          <span className="pill">{cartLines.length} producto(s)</span>
        </div>

        <div className="pos-service-toggle">
          <button
            type="button"
            className={serviceMode === "DINE_IN" ? "active" : ""}
            onClick={() => setServiceMode("DINE_IN")}
          >
            Aquí
          </button>
          <button
            type="button"
            className={serviceMode === "TAKEAWAY" ? "active" : ""}
            onClick={() => setServiceMode("TAKEAWAY")}
          >
            Para llevar
          </button>
        </div>

        <div className="pos-cart-lines">
          {cartLines.length === 0 ? (
            <p className="muted">Toca un producto para agregarlo.</p>
          ) : (
            cartLines.map((line) => (
              <div className="pos-cart-line" key={line.id}>
                <div>
                  <strong>{line.name}</strong>
                  <div className="muted">{money.format(line.price)} c/u</div>
                </div>
                <div className="pos-qty-control">
                  <button type="button" onClick={() => change(line.id, -1)}>
                    −
                  </button>
                  <strong>{line.quantity}</strong>
                  <button type="button" onClick={() => change(line.id, 1)}>
                    +
                  </button>
                </div>
                <strong>{money.format(line.price * line.quantity)}</strong>
              </div>
            ))
          )}
        </div>

        <div className="pos-total">
          <span>Total</span>
          <strong>{money.format(total)}</strong>
        </div>

        <form action={createShadowSale} className="stack pos-checkout">
          <input
            type="hidden"
            name="cart"
            value={JSON.stringify(
              cartLines.map((line) => ({
                externalId: line.id,
                quantity: line.quantity,
              })),
            )}
          />
          <input type="hidden" name="serviceMode" value={serviceMode} />
          {serviceMode === "DINE_IN" && (
            <label>
              Mesa / referencia
              <input name="tableLabel" placeholder="Ej. Mesa 3, balcón 1" />
            </label>
          )}

          <label>
            Método de pago
            <select name="paymentMethod" defaultValue="CASH">
              <option value="CASH">Efectivo</option>
              <option value="CARD">Tarjeta</option>
              <option value="TRANSFER">Transferencia</option>
            </select>
          </label>

          <label>
            Nota
            <input name="note" placeholder="Opcional" maxLength={300} />
          </label>

          <button
            type="submit"
            className="pos-pay-button"
            disabled={cartLines.length === 0}
          >
            Registrar espejo · {money.format(total)}
          </button>
        </form>

        <p className="pos-shadow-warning">
          MODO ESPEJO: esta venta no descuenta inventario ni afecta caja.
        </p>
      </aside>
    </div>
  );
}
