export type PosPaymentMethod = "CASH" | "CARD" | "TRANSFER";

export function resolveCashTender(
  formData: FormData,
  total: number | string,
  paymentMethod: PosPaymentMethod,
) {
  const totalNumber = Number(total);
  if (!Number.isFinite(totalNumber) || totalNumber < 0) {
    throw new Error("Total de cobro inválido");
  }

  if (paymentMethod !== "CASH") {
    return {
      tenderedAmount: null as string | null,
      changeAmount: null as string | null,
      tendered: null as number | null,
      change: null as number | null,
    };
  }

  const raw = String(formData.get("cashTendered") ?? "").trim();
  const tenderedNumber = Number(raw);

  if (!raw || !Number.isFinite(tenderedNumber) || tenderedNumber < 0) {
    throw new Error("Captura cuánto efectivo entregó el cliente");
  }

  const totalCents = Math.round(totalNumber * 100);
  const tenderedCents = Math.round(tenderedNumber * 100);

  if (tenderedCents < totalCents) {
    const missing = ((totalCents - tenderedCents) / 100).toFixed(2);
    throw new Error("Faltan $" + missing + " para completar el pago");
  }

  const changeCents = tenderedCents - totalCents;

  return {
    tenderedAmount: (tenderedCents / 100).toFixed(2),
    changeAmount: (changeCents / 100).toFixed(2),
    tendered: tenderedCents / 100,
    change: changeCents / 100,
  };
}
