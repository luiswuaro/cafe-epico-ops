import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  loyverseCustomers,
  loyverseReceiptLines,
  loyverseReceipts,
} from "@/src/infrastructure/db/schema";

const FOOD_NAMES = new Set([
  "CROISSANT JAMÓN",
  "Cuernitos jamon y queso",
  "FLAN",
  "Muffins",
  "Pan SOLO",
  "Rebanada de panqué de zanahoria",
]);

function mexicoDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const part = (type: string) =>
    parts.find((row) => row.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}

function pctChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function startOfLocalDayDaysAgo(days: number) {
  const now = new Date();
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function isFood(name: string) {
  return FOOD_NAMES.has(name);
}

export async function getBusinessAnalytics(organizationId: string) {
  const db = getDb();
  const since30 = startOfLocalDayDaysAgo(30);

  const [receipts, lines, customers] = await Promise.all([
    db
      .select({
        externalId: loyverseReceipts.externalId,
        receiptDate: loyverseReceipts.receiptDate,
        totalMoney: loyverseReceipts.totalMoney,
        payload: loyverseReceipts.payload,
      })
      .from(loyverseReceipts)
      .where(
        and(
          eq(loyverseReceipts.organizationId, organizationId),
          eq(loyverseReceipts.receiptType, "SALE"),
          gte(loyverseReceipts.receiptDate, since30),
        ),
      ),
    db
      .select({
        receiptExternalId: loyverseReceiptLines.receiptExternalId,
        quantity: loyverseReceiptLines.quantity,
        grossTotalMoney: loyverseReceiptLines.grossTotalMoney,
        payload: loyverseReceiptLines.payload,
      })
      .from(loyverseReceiptLines)
      .where(eq(loyverseReceiptLines.organizationId, organizationId)),
    db
      .select({
        payload: loyverseCustomers.payload,
      })
      .from(loyverseCustomers)
      .where(eq(loyverseCustomers.organizationId, organizationId)),
  ]);

  const receiptById = new Map(
    receipts.map((receipt) => [receipt.externalId, receipt]),
  );

  const shift = {
    morning: {
      tickets: 0,
      sales: 0,
      customerTickets: 0,
      beverageUnits: 0,
      foodUnits: 0,
      cogs: 0,
      cogs: 0,
    },
    afternoon: {
      tickets: 0,
      sales: 0,
      customerTickets: 0,
      beverageUnits: 0,
      foodUnits: 0,
    },
  };

  const daily = new Map<
    string,
    {
      sales: number;
      tickets: number;
      morningSales: number;
      afternoonSales: number;
      cogs: number;
    }
  >();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    tickets: 0,
    sales: 0,
  }));

  for (const receipt of receipts) {
    if (!receipt.receiptDate) continue;
    const local = mexicoDateParts(receipt.receiptDate);
    const target =
      local.hour < 16 ? shift.morning : shift.afternoon;
    const money = Number(receipt.totalMoney ?? 0);
    target.tickets += 1;
    target.sales += money;
    if (
      typeof receipt.payload.customer_id === "string" &&
      receipt.payload.customer_id
    ) {
      target.customerTickets += 1;
    }

    const day = daily.get(local.date) ?? {
      sales: 0,
      tickets: 0,
      morningSales: 0,
      afternoonSales: 0,
      cogs: 0,
    };
    day.sales += money;
    day.tickets += 1;
    if (local.hour < 16) day.morningSales += money;
    else day.afternoonSales += money;
    daily.set(local.date, day);

    if (local.hour >= 0 && local.hour <= 23) {
      hourly[local.hour].tickets += 1;
      hourly[local.hour].sales += money;
    }
  }

  const productByShift = {
    morning: new Map<string, { qty: number; sales: number; cogs: number }>(),
    afternoon: new Map<string, { qty: number; sales: number; cogs: number }>(),
  };

  for (const line of lines) {
    const receipt = receiptById.get(line.receiptExternalId);
    if (!receipt?.receiptDate) continue;

    const local = mexicoDateParts(receipt.receiptDate);
    const target =
      local.hour < 16 ? shift.morning : shift.afternoon;
    const products =
      local.hour < 16
        ? productByShift.morning
        : productByShift.afternoon;

    const name =
      typeof line.payload.item_name === "string"
        ? line.payload.item_name
        : "Sin nombre";
    const qty = Number(line.quantity ?? 0);
    const sales = Number(
      line.payload.total_money ?? line.grossTotalMoney ?? 0,
    );
    const cogs = Number(
      line.payload.cost_total ??
        Number(line.payload.cost ?? 0) * qty,
    );

    if (isFood(name)) target.foodUnits += qty;
    else target.beverageUnits += qty;
    target.cogs += cogs;

    const day = daily.get(local.date);
    if (day) day.cogs += cogs;

    const product = products.get(name) ?? { qty: 0, sales: 0, cogs: 0 };
    product.qty += qty;
    product.sales += sales;
    product.cogs += cogs;
    products.set(name, product);
  }

  const sortedDays = [...daily.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const latestDate = sortedDays.at(-1)?.[0] ?? null;

  const last14 = sortedDays.slice(-14);
  const previous7 = last14.slice(0, Math.max(0, last14.length - 7));
  const last7 = last14.slice(-7);

  const aggregateDays = (
    rows: typeof last7,
  ) =>
    rows.reduce(
      (acc, [, row]) => ({
        sales: acc.sales + row.sales,
        tickets: acc.tickets + row.tickets,
        cogs: acc.cogs + row.cogs,
      }),
      { sales: 0, tickets: 0, cogs: 0 },
    );

  const previous = aggregateDays(previous7);
  const current = aggregateDays(last7);
  const currentAvgTicket =
    current.tickets > 0 ? current.sales / current.tickets : 0;
  const previousAvgTicket =
    previous.tickets > 0 ? previous.sales / previous.tickets : 0;

  const activeCustomers = customers.filter(
    (customer) => customer.payload.deleted_at == null,
  );
  const customerStats = activeCustomers.map((customer) => ({
    createdAt:
      typeof customer.payload.created_at === "string"
        ? new Date(customer.payload.created_at)
        : null,
    visits: Number(customer.payload.total_visits ?? 0),
    spent: Number(customer.payload.total_spent ?? 0),
  }));

  const now = Date.now();
  const new7 = customerStats.filter(
    (customer) =>
      customer.createdAt &&
      now - customer.createdAt.getTime() <= 7 * 86400000,
  ).length;
  const new30 = customerStats.filter(
    (customer) =>
      customer.createdAt &&
      now - customer.createdAt.getTime() <= 30 * 86400000,
  ).length;
  const activated = customerStats.filter(
    (customer) => customer.visits >= 1,
  ).length;
  const repeat = customerStats.filter(
    (customer) => customer.visits >= 2,
  ).length;

  const totalTickets =
    shift.morning.tickets + shift.afternoon.tickets;
  const identifiedTickets =
    shift.morning.customerTickets +
    shift.afternoon.customerTickets;
  const captureRate =
    totalTickets > 0 ? (identifiedTickets / totalTickets) * 100 : 0;

  const topProducts = (
    map: Map<string, { qty: number; sales: number; cogs: number }>,
  ) =>
    [...map.entries()]
      .map(([name, values]) => ({
        name,
        ...values,
        contribution: values.sales - values.cogs,
        contributionPct:
          values.sales > 0
            ? ((values.sales - values.cogs) / values.sales) * 100
            : 0,
      }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

  const salesChange = pctChange(current.sales, previous.sales);
  const ticketsChange = pctChange(current.tickets, previous.tickets);
  const avgTicketChange = pctChange(
    currentAvgTicket,
    previousAvgTicket,
  );
  const currentContribution = current.sales - current.cogs;
  const previousContribution = previous.sales - previous.cogs;
  const currentContributionPct =
    current.sales > 0 ? (currentContribution / current.sales) * 100 : 0;
  const previousContributionPct =
    previous.sales > 0 ? (previousContribution / previous.sales) * 100 : 0;
  const contributionChange = pctChange(
    currentContribution,
    previousContribution,
  );

  const suggestions: Array<{
    level: "INFO" | "ACTION";
    title: string;
    detail: string;
  }> = [];

  if (
    salesChange != null &&
    salesChange <= -8 &&
    ticketsChange != null &&
    ticketsChange <= -8 &&
    avgTicketChange != null &&
    Math.abs(avgTicketChange) < 5
  ) {
    suggestions.push({
      level: "ACTION",
      title: "La caída viene de tráfico, no de ticket",
      detail: `Ventas 7d ${salesChange.toFixed(
        1,
      )}% y tickets ${ticketsChange.toFixed(
        1,
      )}%, mientras el ticket promedio cambió ${avgTicketChange.toFixed(
        1,
      )}%. Prioridad: generar visitas y recuperar clientes.`,
    });
  } else if (
    avgTicketChange != null &&
    avgTicketChange <= -8 &&
    (ticketsChange == null || Math.abs(ticketsChange) < 5)
  ) {
    suggestions.push({
      level: "ACTION",
      title: "El tráfico está, pero el ticket cayó",
      detail: `Ticket promedio 7d ${avgTicketChange.toFixed(
        1,
      )}%. Prioridad: alimentos, extras y venta sugerida.`,
    });
  }

  if (captureRate < 40) {
    suggestions.push({
      level: "ACTION",
      title: "Hay margen para captar más clientes de lealtad",
      detail: `Solo ${captureRate.toFixed(
        1,
      )}% de los tickets del periodo están asociados a un cliente. Conviene medir y mejorar la invitación en caja.`,
    });
  }

  const afternoonShare =
    shift.morning.sales + shift.afternoon.sales > 0
      ? (shift.afternoon.sales /
          (shift.morning.sales + shift.afternoon.sales)) *
        100
      : 0;
  if (afternoonShare >= 58) {
    suggestions.push({
      level: "INFO",
      title: "La tarde concentra la mayor parte de la venta",
      detail: `${afternoonShare.toFixed(
        1,
      )}% de la venta de 30 días ocurre desde las 16:00. Mise en place, leche, hielo, pan y bases deben llegar fuertes a ese corte.`,
    });
  }

  return {
    latestDate,
    shift: {
      morning: {
        ...shift.morning,
        avgTicket:
          shift.morning.tickets > 0
            ? shift.morning.sales / shift.morning.tickets
            : 0,
        captureRate:
          shift.morning.tickets > 0
            ? (shift.morning.customerTickets /
                shift.morning.tickets) *
              100
            : 0,
      },
      afternoon: {
        ...shift.afternoon,
        avgTicket:
          shift.afternoon.tickets > 0
            ? shift.afternoon.sales / shift.afternoon.tickets
            : 0,
        captureRate:
          shift.afternoon.tickets > 0
            ? (shift.afternoon.customerTickets /
                shift.afternoon.tickets) *
              100
            : 0,
      },
    },
    trend: {
      current,
      previous,
      currentAvgTicket,
      previousAvgTicket,
      salesChange,
      ticketsChange,
      avgTicketChange,
      currentContribution,
      previousContribution,
      currentContributionPct,
      previousContributionPct,
      contributionChange,
    },
    loyalty: {
      customers: activeCustomers.length,
      activated,
      repeat,
      new7,
      new30,
      captureRate,
      averageVisits:
        customerStats.length > 0
          ? customerStats.reduce((sum, row) => sum + row.visits, 0) /
            customerStats.length
          : 0,
      averageSpent:
        customerStats.length > 0
          ? customerStats.reduce((sum, row) => sum + row.spent, 0) /
            customerStats.length
          : 0,
    },
    hourly: hourly.filter((row) => row.tickets > 0),
    topMorning: topProducts(productByShift.morning),
    topAfternoon: topProducts(productByShift.afternoon),
    suggestions,
  };
}
