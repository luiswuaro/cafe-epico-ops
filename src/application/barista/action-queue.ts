export type BaristaAction = {
  priority: "ACTION" | "WATCH" | "INFO";
  area: "APERTURA" | "ESPRESSO" | "INVENTARIO" | "RUSH" | "TUESTE" | "ENTREGA" | "INCIDENCIA";
  title: string;
  detail: string;
  href?: string;
  rank: number;
};

function calibrationAdvice(input: {
  doseG: string | number;
  yieldG: string | number;
  brewTimeS: string | number;
  withinYieldSpec: boolean | null;
  withinTimeSpec: boolean;
}) {
  const dose = Number(input.doseG);
  const yieldG = Number(input.yieldG);
  const seconds = Number(input.brewTimeS);
  const ratio =
    Number.isFinite(dose) && dose > 0 && Number.isFinite(yieldG)
      ? yieldG / dose
      : null;

  if (input.withinYieldSpec !== true) {
    return ratio == null
      ? "Primero confirma dosis y rendimiento; después interpreta el tiempo."
      : "El rendimiento está fuera de objetivo (1:" +
          ratio.toFixed(2) +
          "). Corrige dosis/rendimiento y vuelve a medir antes de mover otra variable.";
  }

  if (!input.withinTimeSpec && Number.isFinite(seconds)) {
    if (seconds < 22) {
      return "Con dosis y rendimiento correctos, el flujo está rápido. Prueba un ajuste pequeño más fino y vuelve a medir.";
    }
    if (seconds > 35) {
      return "Con dosis y rendimiento correctos, el flujo está lento. Prueba un ajuste pequeño más grueso y vuelve a medir.";
    }
  }

  return "Cambia una sola variable y registra otro QC para comparar.";
}

export function buildBaristaActionQueue(input: {
  currentHour: number;
  opening: {
    total: number;
    completed: number;
    next: { title: string } | null;
  };
  handoff: {
    total: number;
    completed: number;
  };
  latestQc: {
    doseG: string | number;
    yieldG: string | number;
    brewTimeS: string | number;
    withinYieldSpec: boolean | null;
    withinTimeSpec: boolean;
  } | null;
  shiftRisks: Array<{
    itemName: string;
    status: "ACTION" | "WATCH";
    inventoryNeedsCorrection?: boolean;
    shortage?: number;
    unitLabel: string;
    displayUnit?: string | null;
    displayFactor?: number | null;
    expectedShift: number;
    operationalStock?: number;
  }>;
  nextPeak: { hour: number; tickets: number; sales: number } | null;
  activeRoast: { batchCode: string; lotName: string } | null;
  incidents: Array<{
    id: string;
    severity: string;
    area: string | null;
    note: string | null;
  }>;
  inventoryCorrectionCount: number;
}) {
  const actions: BaristaAction[] = [];

  if (
    input.opening.total > 0 &&
    input.opening.completed < input.opening.total
  ) {
    actions.push({
      priority: "ACTION",
      area: "APERTURA",
      title: "Completar apertura",
      detail: input.opening.next
        ? "Siguiente tarea: " + input.opening.next.title + "."
        : "Quedan " +
          (input.opening.total - input.opening.completed) +
          " tareas de apertura.",
      href: "/checklists",
      rank: 10,
    });
  }

  if (!input.latestQc) {
    actions.push({
      priority: "ACTION",
      area: "ESPRESSO",
      title: "Confirmar espresso estándar 1:2",
      detail:
        "Falta un QC válido del espresso base de barra para el turno.",
      href: "/quality/espresso",
      rank: 20,
    });
  } else if (
    !input.latestQc.withinTimeSpec ||
    input.latestQc.withinYieldSpec !== true
  ) {
    actions.push({
      priority: "ACTION",
      area: "ESPRESSO",
      title: "Recalibrar espresso",
      detail: calibrationAdvice(input.latestQc),
      href: "/quality/espresso",
      rank: 20,
    });
  }

  if (input.inventoryCorrectionCount > 0) {
    actions.push({
      priority: "ACTION",
      area: "INVENTARIO",
      title:
        "Corregir " +
        input.inventoryCorrectionCount +
        " existencia(s) negativas",
      detail:
        "Loyverse tiene cantidades menores a cero. Haz conteo físico antes de tratarlas como faltante real.",
      href: "/inventory",
      rank: 30,
    });
  }

  for (const risk of input.shiftRisks
    .filter((row) => !row.inventoryNeedsCorrection)
    .slice(0, 2)) {
    const factor = risk.displayFactor ?? 1;
    const unit =
      risk.displayUnit ??
      (risk.unitLabel === "peso/volumen"
        ? "u. Loyverse"
        : risk.unitLabel);
    const shortage = (risk.shortage ?? 0) * factor;

    actions.push({
      priority: risk.status,
      area: "INVENTARIO",
      title: "Reponer " + risk.itemName,
      detail:
        (shortage > 0
          ? "Faltan aproximadamente " +
            shortage.toFixed(shortage < 10 ? 2 : 0) +
            " " +
            unit +
            " para cubrir el turno."
          : "La cobertura está cerca del consumo esperado del turno."),
      href: "/inventory",
      rank: risk.status === "ACTION" ? 35 : 55,
    });
  }

  if (input.nextPeak) {
    const hoursAway = input.nextPeak.hour - input.currentHour;
    if (hoursAway >= 0 && hoursAway <= 1) {
      actions.push({
        priority: "WATCH",
        area: "RUSH",
        title:
          "Preparar estación para " +
          String(input.nextPeak.hour).padStart(2, "0") +
          ":00",
        detail:
          "Es la hora más fuerte dentro de la ventana inmediata según días comparables.",
        rank: 40,
      });
    } else if (hoursAway > 1 && hoursAway <= 3) {
      actions.push({
        priority: "INFO",
        area: "RUSH",
        title:
          "Siguiente pico cercano: " +
          String(input.nextPeak.hour).padStart(2, "0") +
          ":00",
        detail:
          "Todavía hay margen; revisa mise en place antes de acercarte a esa hora.",
        rank: 70,
      });
    }
  }

  if (!input.activeRoast) {
    actions.push({
      priority: "WATCH",
      area: "TUESTE",
      title: "Espresso sin batch activo",
      detail:
        "Los QC del espresso no se podrán relacionar con reposo y desempeño del tueste hasta asignar un batch.",
      rank: 60,
    });
  }

  const urgentIncident = input.incidents.find(
    (incident) =>
      incident.severity === "URGENT" ||
      incident.severity === "IMPORTANT",
  );
  if (urgentIncident) {
    actions.push({
      priority:
        urgentIncident.severity === "URGENT" ? "ACTION" : "WATCH",
      area: "INCIDENCIA",
      title: "Incidencia pendiente: " + (urgentIncident.area ?? "Barra"),
      detail: urgentIncident.note ?? "Requiere revisión.",
      rank: urgentIncident.severity === "URGENT" ? 15 : 50,
    });
  }

  const handoffWindow = input.currentHour >= 15;
  if (
    handoffWindow &&
    input.handoff.total > 0 &&
    input.handoff.completed < input.handoff.total
  ) {
    actions.push({
      priority: input.currentHour >= 16 ? "ACTION" : "WATCH",
      area: "ENTREGA",
      title: "Preparar entrega de turno",
      detail:
        "Quedan " +
        (input.handoff.total - input.handoff.completed) +
        " tareas para dejar barra, faltantes e incidencias documentados.",
      href: "/handoff",
      rank: input.currentHour >= 16 ? 25 : 65,
    });
  }

  return actions
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 7);
}
