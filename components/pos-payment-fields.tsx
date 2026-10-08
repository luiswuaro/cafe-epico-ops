"use client";

import { useMemo, useState } from "react";

type PaymentMethod = "CASH" | "CARD" | "TRANSFER";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function tenderOptions(total: number) {
  if (!Number.isFinite(total) || total <= 0) return [];

  const candidates = [
    roundMoney(total),
    Math.ceil(total / 10) * 10,
    Math.ceil(total / 20) * 20,
    Math.ceil(total / 50) * 50,
    Math.ceil(total / 100) * 100,
    200,
    500,
    1000,
  ]
    .map(roundMoney)
    .filter((value) => value >= total && value <= 5000);

  return [...new Set(candidates)].slice(0, 5);
}

export function PosPaymentFields({
  total,
  cashOpen,
}: {
  total: number;
  cashOpen: boolean;
}) {
  const [method, setMethod] = useState<PaymentMethod>(
    cashOpen ? "CASH" : "CARD",
  );
  const [cashTendered, setCashTendered] = useState("");

  const received = Number(cashTendered);
  const hasValidReceived =
    cashTendered.trim() !== "" && Number.isFinite(received) && received >= 0;
  const change = hasValidReceived ? roundMoney(received - total) : null;
  const options = useMemo(() => tenderOptions(total), [total]);

  return (
    <div className="pos-payment-fields">
      <label>
        Método de pago
        <select
          name="paymentMethod"
          value={method}
          onChange={(event) => {
            const next = event.target.value as PaymentMethod;
            setMethod(next);
            if (next !== "CASH") setCashTendered("");
          }}
        >
          <option value="CASH" disabled={!cashOpen}>
            Efectivo{cashOpen ? "" : " · abre caja"}
          </option>
          <option value="CARD">Tarjeta</option>
          <option value="TRANSFER">Transferencia</option>
        </select>
      </label>

      {method === "CASH" && cashOpen && (
        <div className="cash-tender-panel">
          <div className="cash-tender-summary">
            <span>Total a cobrar</span>
            <strong>{money.format(total)}</strong>
          </div>

          <label>
            ¿Con cuánto paga?
            <input
              name="cashTendered"
              type="number"
              min={total.toFixed(2)}
              step="0.01"
              inputMode="decimal"
              value={cashTendered}
              onChange={(event) => setCashTendered(event.target.value)}
              placeholder={total.toFixed(2)}
              required
            />
          </label>

          <div className="cash-tender-presets" aria-label="Montos rápidos">
            {options.map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => setCashTendered(value.toFixed(2))}
              >
                {value === roundMoney(total)
                  ? "Exacto"
                  : money.format(value)}
              </button>
            ))}
          </div>

          <div
            className={
              change != null && change >= 0
                ? "cash-change cash-change-ok"
                : "cash-change"
            }
          >
            <span>{change != null && change < 0 ? "Falta" : "Cambio"}</span>
            <strong>
              {change == null
                ? "—"
                : money.format(Math.abs(change))}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}
