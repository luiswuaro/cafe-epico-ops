/**
 * Escenario solicitado por Café Épico: todos los cobros OPS incluidos tienen IVA
 * trasladado 16% DENTRO del precio público, sin IVA acreditable.
 * ISR RESICO supuesto 2% sobre ingresos sin IVA, sin deducciones.
 *
 * No sustituye una declaración SAT: RESICO aplica tablas por ingresos totales,
 * retenciones, CFDI, devoluciones y otros giros no incluidos en OPS.
 */
export const IVA_RATE_PERCENT = 16;
export const ISR_RESICO_ASSUMED_RATE_PERCENT = 2;

const inCents=(amount:number)=>Math.round(Math.max(0,Number.isFinite(amount)?amount:0)*100);

export function estimateTaxesOnGrossSales(grossSalesMxn:number){
  const grossCents=inCents(grossSalesMxn);
  // Ingresos POS son precios públicos con IVA incluido. No usar 16% directo
  // sobre el total del ticket: 116 de cobro representan 100 base + 16 IVA.
  const baseCents=Math.round(grossCents*100/(100+IVA_RATE_PERCENT));
  const vatCents=grossCents-baseCents;
  const isrCents=Math.round(baseCents*ISR_RESICO_ASSUMED_RATE_PERCENT/100);
  return {
    gross:grossCents/100,
    beforeVat:baseCents/100,
    vat:vatCents/100,
    isr:isrCents/100,
    totalTaxes:(vatCents+isrCents)/100,
    afterTaxes:(baseCents-isrCents)/100,
  };
}

// Se usa en el punto de equilibrio; mantener porcentajes sobre VENTA CON IVA.
export const afterTaxRevenueRatio=
  (100-ISR_RESICO_ASSUMED_RATE_PERCENT)/(100+IVA_RATE_PERCENT);
