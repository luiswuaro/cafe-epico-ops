"use client";

import { useMemo, useState } from "react";
import { PosPaymentFields } from "@/components/pos-payment-fields";
import {
  createPosCustomer,
  createShadowCommand,
  createShadowSale,
} from "./actions";

type CatalogItem = {
  id: string;
  name: string;
  category: "CALIENTES" | "FRÍAS" | "ALIMENTOS";
  price: number;
};

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  pointsBalance: number;
};

type CartLine = {
  key: string;
  externalId: string;
  note: string;
};

type Props = {
  catalog: CatalogItem[];
  customers: Customer[];
  selectedCustomerId?: string | null;
  cashOpen: boolean;
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export function PosClient({
  catalog,
  customers,
  selectedCustomerId = null,
  cashOpen,
}: Props) {
  const [category, setCategory] = useState<"TODAS" | CatalogItem["category"]>(
    "CALIENTES",
  );
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [serviceMode, setServiceMode] =
    useState<"DINE_IN" | "TAKEAWAY">("DINE_IN");
  const [customerId, setCustomerId] = useState(selectedCustomerId ?? "");

  const catalogById = useMemo(
    () => new Map(catalog.map((item) => [item.id, item])),
    [catalog],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es-MX");
    return catalog.filter((item) => {
      const categoryOk = category === "TODAS" || item.category === category;
      const queryOk = !q || item.name.toLocaleLowerCase("es-MX").includes(q);
      return categoryOk && queryOk;
    });
  }, [catalog, category, query]);

  const cartLines = cart.flatMap((line) => {
    const item = catalogById.get(line.externalId);
    return item ? [{ ...line, item }] : [];
  });

  const total = cartLines.reduce((sum, line) => sum + line.item.price, 0);

  const selectedCustomer =
    customers.find((customer) => customer.id === customerId) ?? null;
  const pointsPreview = selectedCustomer
    ? Math.round(total * 0.05 * 100) / 100
    : 0;

  const productCount = (id: string) =>
    cart.reduce(
      (sum, line) => sum + (line.externalId === id ? 1 : 0),
      0,
    );

  function add(externalId: string) {
    setCart((current) => [
      ...current,
      {
        key: globalThis.crypto.randomUUID(),
        externalId,
        note: "",
      },
    ]);
  }

  function remove(key: string) {
    setCart((current) => current.filter((line) => line.key !== key));
  }

  function duplicate(line: CartLine) {
    setCart((current) => [
      ...current,
      {
        key: globalThis.crypto.randomUUID(),
        externalId: line.externalId,
        note: "",
      },
    ]);
  }

  function updateNote(key: string, note: string) {
    setCart((current) =>
      current.map((line) => (line.key === key ? { ...line, note } : line)),
    );
  }

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
          {visible.map((item) => {
            const count = productCount(item.id);
            return (
              <button
                type="button"
                className="pos-product-card"
                key={item.id}
                onClick={() => add(item.id)}
              >
                <span className="eyebrow">{item.category}</span>
                <strong>{item.name}</strong>
                <span>{money.format(item.price)}</span>
                {count > 0 && <span className="pos-product-qty">{count}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="card pos-cart">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ORDEN ESPEJO</p>
            <h2>Cuenta</h2>
          </div>
          <span className="pill">{cartLines.length} unidad(es)</span>
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
            cartLines.map((line, index) => (
              <div className="pos-cart-line pos-cart-unit" key={line.key}>
                <div className="pos-cart-unit-main">
                  <div className="pos-cart-unit-title">
                    <strong>
                      {index + 1}. {line.item.name}
                    </strong>
                    <strong>{money.format(line.item.price)}</strong>
                  </div>

                  <input
                    className="pos-line-note"
                    value={line.note}
                    onChange={(event) =>
                      updateNote(line.key, event.target.value)
                    }
                    placeholder="Nota: sin hielo, deslactosada, extra caliente..."
                    maxLength={180}
                    aria-label={"Nota para " + line.item.name}
                  />
                </div>

                <div className="pos-unit-actions">
                  <button
                    type="button"
                    onClick={() => duplicate(line)}
                    title="Agregar otra igual"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(line.key)}
                    title="Quitar"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pos-total">
          <span>Total</span>
          <strong>{money.format(total)}</strong>
        </div>

        <div className="pos-customer-box">
          <label>
            Cliente / puntos
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Sin cliente</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.pointsBalance.toFixed(2)} pts
                </option>
              ))}
            </select>
          </label>

          {selectedCustomer ? (
            <p className="muted compact-copy">
              Saldo actual:{" "}
              <strong>{selectedCustomer.pointsBalance.toFixed(2)} pts</strong>
              {" · "}
              Esta compra generaría{" "}
              <strong>{pointsPreview.toFixed(2)} pts</strong> al 5%.
            </p>
          ) : (
            <p className="muted compact-copy">
              Selecciona un cliente para calcular el 5% de puntos.
            </p>
          )}

          <details>
            <summary>+ Registrar cliente</summary>
            <form action={createPosCustomer} className="stack">
              <label>
                Nombre
                <input name="name" required minLength={2} />
              </label>
              <label>
                Teléfono
                <input name="phone" inputMode="tel" />
              </label>
              <label>
                Correo
                <input name="email" type="email" />
              </label>
              <button type="submit">Guardar cliente</button>
            </form>
          </details>
        </div>

        <form action={createShadowSale} className="stack pos-checkout">
          <input
            type="hidden"
            name="cart"
            value={JSON.stringify(
              cartLines.map((line) => ({
                externalId: line.externalId,
                quantity: 1,
                note: line.note.trim() || null,
              })),
            )}
          />
          <input type="hidden" name="serviceMode" value={serviceMode} />
          <input type="hidden" name="customerId" value={customerId} />

          {serviceMode === "DINE_IN" && (
            <label>
              Mesa / referencia
              <input name="tableLabel" placeholder="Ej. Mesa 3, balcón 1" />
            </label>
          )}

          <PosPaymentFields total={total} cashOpen={cashOpen} />

          <label>
            Nota general de la mesa / orden
            <input
              name="note"
              placeholder="Ej. entregar todo junto, cumpleaños..."
              maxLength={300}
            />
          </label>

          <div className="pos-command-actions">
            <button
              type="submit"
              formAction={createShadowCommand}
              className="pos-command-button"
              formNoValidate
              disabled={cartLines.length === 0}
            >
              Enviar comanda
            </button>
            <button
              type="submit"
              className="pos-pay-button"
              disabled={cartLines.length === 0}
            >
              Registrar espejo · {money.format(total)}
            </button>
          </div>
        </form>

        <p className="pos-shadow-warning">
          MODO ESPEJO: comandas, puntos e inventario son simulación. Nada se
          descuenta ni se acredita todavía.
        </p>
      </aside>
    </div>
  );
}
