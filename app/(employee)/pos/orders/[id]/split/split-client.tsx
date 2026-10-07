"use client";

import { useMemo, useState } from "react";
import { saveOrderSplit } from "./actions";

type Line = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export function SplitAccountBuilder({
  orderId,
  lines,
}: {
  orderId: string;
  lines: Line[];
}) {
  const [accountCount, setAccountCount] = useState(2);
  const units = useMemo(
    () =>
      lines.flatMap((line) =>
        Array.from(
          { length: Math.max(0, Math.round(line.quantity)) },
          (_, index) => ({
            key: line.id + ":" + index,
            lineId: line.id,
            name: line.name,
            unitPrice: line.unitPrice,
            unitNumber: index + 1,
          }),
        ),
      ),
    [lines],
  );

  const [assignments, setAssignments] = useState<Record<string, number>>(() =>
    Object.fromEntries(units.map((unit) => [unit.key, 1])),
  );

  const payload = useMemo(() => {
    const grouped = new Map<
      string,
      { account: number; lineId: string; quantity: number }
    >();

    for (const unit of units) {
      const account = assignments[unit.key] ?? 1;
      const key = account + "|" + unit.lineId;
      const current = grouped.get(key);

      if (current) current.quantity += 1;
      else {
        grouped.set(key, {
          account,
          lineId: unit.lineId,
          quantity: 1,
        });
      }
    }

    return [...grouped.values()];
  }, [assignments, units]);

  const totals = Array.from({ length: accountCount }, (_, index) => {
    const account = index + 1;
    return units
      .filter((unit) => (assignments[unit.key] ?? 1) === account)
      .reduce((sum, unit) => sum + unit.unitPrice, 0);
  });

  function changeCount(next: number) {
    const bounded = Math.max(2, Math.min(8, next));
    setAccountCount(bounded);
    setAssignments((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, value]) => [
          key,
          Math.min(value, bounded),
        ]),
      ),
    );
  }

  return (
    <form action={saveOrderSplit} className="stack">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="accountCount" value={accountCount} />
      <input
        type="hidden"
        name="allocations"
        value={JSON.stringify(payload)}
      />

      <div className="split-count-control">
        <strong>Número de cuentas</strong>
        <div>
          <button
            type="button"
            onClick={() => changeCount(accountCount - 1)}
            disabled={accountCount <= 2}
          >
            −
          </button>
          <strong>{accountCount}</strong>
          <button
            type="button"
            onClick={() => changeCount(accountCount + 1)}
            disabled={accountCount >= 8}
          >
            +
          </button>
        </div>
      </div>

      <div className="split-account-summary">
        {totals.map((total, index) => (
          <div key={index}>
            <span>Cuenta {index + 1}</span>
            <strong>{"$" + total.toFixed(2)}</strong>
          </div>
        ))}
      </div>

      <div className="split-unit-list">
        {units.map((unit) => (
          <div className="split-unit-row" key={unit.key}>
            <div>
              <strong>{unit.name}</strong>
              <span className="muted">
                Unidad {unit.unitNumber} · {"$" + unit.unitPrice.toFixed(2)}
              </span>
            </div>
            <select
              aria-label={"Cuenta para " + unit.name}
              value={assignments[unit.key] ?? 1}
              onChange={(event) =>
                setAssignments((current) => ({
                  ...current,
                  [unit.key]: Number(event.target.value),
                }))
              }
            >
              {Array.from({ length: accountCount }, (_, index) => (
                <option value={index + 1} key={index + 1}>
                  Cuenta {index + 1}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <button type="submit">Guardar división</button>
    </form>
  );
}
