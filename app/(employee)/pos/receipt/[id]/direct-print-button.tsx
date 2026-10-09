"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STORAGE_KEY = "cafe-epico-printer-bridge-v1";
const PAPER_WIDTH = 384;
const SIDE_MARGIN = 18;
const CONTENT_WIDTH = PAPER_WIDTH - SIDE_MARGIN * 2;

export type DirectReceiptPayload = {
  folio: string;
  status: string;
  cancelReason?: string | null;
  date: string;
  employee: string;
  service: string;
  splitLabel?: string | null;
  items: Array<{
    quantity: number;
    name: string;
    note?: string | null;
    total: string;
  }>;
  total: string;
  payment: string;
  customer?: string | null;
  pointsEarned?: string | null;
  pointsBalance?: string | null;
};

export type DirectReceiptTemplate = {
  businessName: string;
  addressLine: string;
  phoneLine: string | null;
  socialLine: string | null;
  headerMessage: string | null;
  footerMessage: string;
  showLogo: boolean;
  logoRasterBase64: string | null;
  logoWidthPx: number | null;
  logoHeightPx: number | null;
  logoAlign: "left" | "center" | "right";
  showBusinessName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showSocial: boolean;
  showFolio: boolean;
  showDate: boolean;
  showEmployee: boolean;
  showService: boolean;
  showCustomer: boolean;
  showPoints: boolean;
  showItemNotes: boolean;
  showNoCfdi: boolean;
  lineWidthChars: number;
  feedLines: number;
  autoCut: boolean;
};

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function wrapByPixels(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return [];

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? current + " " + word : word;

    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (context.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }

    let piece = "";
    for (const character of word) {
      const next = piece + character;
      if (context.measureText(next).width <= maxWidth) {
        piece = next;
      } else {
        if (piece) lines.push(piece);
        piece = character;
      }
    }
    current = piece;
  }

  if (current) lines.push(current);
  return lines;
}

function renderPackedLogo(
  context: CanvasRenderingContext2D,
  template: DirectReceiptTemplate,
  y: number,
) {
  if (
    !template.showLogo ||
    !template.logoRasterBase64 ||
    !template.logoWidthPx ||
    !template.logoHeightPx
  ) {
    return y;
  }

  const width = template.logoWidthPx;
  const height = template.logoHeightPx;
  const bytes = decodeBase64(template.logoRasterBase64);
  const widthBytes = Math.ceil(width / 8);

  let x = SIDE_MARGIN;
  if (template.logoAlign === "center") {
    x = Math.round((PAPER_WIDTH - width) / 2);
  } else if (template.logoAlign === "right") {
    x = PAPER_WIDTH - SIDE_MARGIN - width;
  }

  context.save();
  context.fillStyle = "#000";
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const byteIndex = row * widthBytes + Math.floor(column / 8);
      if ((bytes[byteIndex] & (0x80 >> (column % 8))) !== 0) {
        context.fillRect(x + column, y + row, 1, 1);
      }
    }
  }
  context.restore();

  return y + height + 12;
}

function drawCentered(
  context: CanvasRenderingContext2D,
  text: string,
  y: number,
  font: string,
  lineHeight: number,
) {
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillStyle = "#000";

  const lines = wrapByPixels(context, text, CONTENT_WIDTH);
  for (const line of lines) {
    context.fillText(line, PAPER_WIDTH / 2, y);
    y += lineHeight;
  }

  return y;
}

function drawWrappedLeft(
  context: CanvasRenderingContext2D,
  text: string,
  y: number,
  font: string,
  lineHeight: number,
  indent = 0,
) {
  context.font = font;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = "#000";

  const maxWidth = CONTENT_WIDTH - indent;
  const lines = wrapByPixels(context, text, maxWidth);
  for (const line of lines) {
    context.fillText(line, SIDE_MARGIN + indent, y);
    y += lineHeight;
  }

  return y;
}

function drawPair(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  y: number,
  options?: {
    font?: string;
    lineHeight?: number;
    emphasize?: boolean;
  },
) {
  const font = options?.font ?? "700 21px Arial, Helvetica, sans-serif";
  const lineHeight = options?.lineHeight ?? 26;

  context.font = font;
  context.textBaseline = "top";
  context.fillStyle = "#000";

  const gap = 14;
  const labelWidth = context.measureText(label).width;
  const valueWidth = context.measureText(value).width;

  if (labelWidth + gap + valueWidth <= CONTENT_WIDTH) {
    context.textAlign = "left";
    context.fillText(label, SIDE_MARGIN, y);
    context.textAlign = "right";
    context.fillText(value, PAPER_WIDTH - SIDE_MARGIN, y);
    return y + lineHeight;
  }

  context.textAlign = "left";
  context.fillText(label, SIDE_MARGIN, y);
  y += lineHeight;

  context.textAlign = "right";
  const maxWidth = CONTENT_WIDTH;
  const wrapped = wrapByPixels(context, value, maxWidth);
  for (const line of wrapped) {
    context.fillText(line, PAPER_WIDTH - SIDE_MARGIN, y);
    y += lineHeight;
  }

  return y;
}

function drawRule(context: CanvasRenderingContext2D, y: number) {
  context.save();
  context.strokeStyle = "#000";
  context.lineWidth = 2;
  context.setLineDash([7, 5]);
  context.beginPath();
  context.moveTo(SIDE_MARGIN, y + 4);
  context.lineTo(PAPER_WIDTH - SIDE_MARGIN, y + 4);
  context.stroke();
  context.restore();
  return y + 14;
}

async function buildRasterTicket(
  ticket: DirectReceiptPayload,
  template: DirectReceiptTemplate,
) {
  await document.fonts.ready;

  const work = document.createElement("canvas");
  work.width = PAPER_WIDTH;
  work.height = 6000;

  const context = work.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No se pudo renderizar el ticket");

  context.fillStyle = "#fff";
  context.fillRect(0, 0, work.width, work.height);

  let y = 14;

  y = renderPackedLogo(context, template, y);

  if (template.showBusinessName) {
    y = drawCentered(
      context,
      template.businessName || "Café Épico",
      y,
      "900 32px Arial, Helvetica, sans-serif",
      38,
    );
  }

  if (template.showAddress && template.addressLine) {
    y = drawCentered(
      context,
      template.addressLine,
      y,
      "700 19px Arial, Helvetica, sans-serif",
      23,
    );
  }

  if (template.showPhone && template.phoneLine) {
    y = drawCentered(
      context,
      template.phoneLine,
      y,
      "700 19px Arial, Helvetica, sans-serif",
      23,
    );
  }

  if (template.showSocial && template.socialLine) {
    y = drawCentered(
      context,
      template.socialLine,
      y,
      "700 19px Arial, Helvetica, sans-serif",
      23,
    );
  }

  if (template.headerMessage) {
    y += 3;
    y = drawCentered(
      context,
      template.headerMessage,
      y,
      "700 19px Arial, Helvetica, sans-serif",
      23,
    );
  }

  if (ticket.splitLabel) {
    y += 4;
    y = drawCentered(
      context,
      ticket.splitLabel,
      y,
      "900 22px Arial, Helvetica, sans-serif",
      27,
    );
  }

  y += 5;
  y = drawRule(context, y);

  if (template.showFolio) {
    y = drawPair(context, "Folio", ticket.folio, y);
  }
  if (template.showDate) {
    y = drawPair(context, "Fecha", ticket.date, y);
  }
  if (template.showEmployee) {
    y = drawPair(context, "Atendió", ticket.employee, y);
  }
  if (template.showService) {
    y = drawPair(context, "Servicio", ticket.service, y);
  }

  y += 2;
  y = drawRule(context, y);

  for (const item of ticket.items) {
    const label = item.quantity + "× " + item.name;
    y = drawPair(context, label, item.total, y, {
      font: "900 22px Arial, Helvetica, sans-serif",
      lineHeight: 27,
    });

    if (template.showItemNotes && item.note) {
      y = drawWrappedLeft(
        context,
        "↳ " + item.note,
        y,
        "700 19px Arial, Helvetica, sans-serif",
        23,
        10,
      );
    }

    y += 5;
  }

  y = drawRule(context, y);
  y = drawPair(context, ticket.status === "CANCELLED" ? "TOTAL ORIGINAL" : "TOTAL", ticket.total, y, {
    font: "900 31px Arial, Helvetica, sans-serif",
    lineHeight: 37,
  });

  y += 3;
  y = drawPair(context, "Pago original", ticket.payment || "—", y);
  if (ticket.status === "CANCELLED") {
    y += 5;
    y = drawRule(context, y);
    y = drawCentered(
      context, "CANCELADO · NO ES VENTA VIGENTE", y,
      "900 25px Arial, Helvetica, sans-serif", 31,
    );
    if (ticket.cancelReason) {
      y = drawCentered(context, ticket.cancelReason, y,
        "700 19px Arial, Helvetica, sans-serif", 24);
    }
  }

  if (template.showCustomer && ticket.customer) {
    y = drawWrappedLeft(
      context,
      "Cliente: " + ticket.customer,
      y,
      "700 20px Arial, Helvetica, sans-serif",
      25,
    );
  }

  if (template.showPoints && ticket.status !== "CANCELLED" && ticket.pointsEarned) {
    y = drawPair(
      context,
      "Puntos ganados",
      "+" + ticket.pointsEarned,
      y,
    );
  }

  if (template.showPoints && ticket.status !== "CANCELLED" && ticket.pointsBalance) {
    y = drawPair(context, "Saldo puntos", ticket.pointsBalance, y);
  }

  y += 3;
  y = drawRule(context, y);

  if (template.footerMessage) {
    y = drawCentered(
      context,
      template.footerMessage,
      y,
      "900 20px Arial, Helvetica, sans-serif",
      25,
    );
  }

  if (template.showNoCfdi) {
    y += 2;
    y = drawCentered(
      context,
      "Este ticket no es CFDI.",
      y,
      "700 18px Arial, Helvetica, sans-serif",
      22,
    );
  }

  y += 10;

  if (y > work.height) {
    throw new Error("El ticket es demasiado largo para renderizarse");
  }

  const height = Math.ceil(y);
  const imageData = context.getImageData(0, 0, PAPER_WIDTH, height);
  const pixels = imageData.data;
  const widthBytes = Math.ceil(PAPER_WIDTH / 8);
  const packed = new Uint8Array(widthBytes * height);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < PAPER_WIDTH; column += 1) {
      const offset = (row * PAPER_WIDTH + column) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

      if (luminance < 190) {
        const byteIndex = row * widthBytes + Math.floor(column / 8);
        packed[byteIndex] |= 0x80 >> (column % 8);
      }
    }
  }

  return {
    dataBase64: encodeBase64(packed),
    width: PAPER_WIDTH,
    height,
    align: "center" as const,
  };
}

export function DirectPrintTicketButton({
  ticket,
  template,
}: {
  ticket: DirectReceiptPayload;
  template: DirectReceiptTemplate;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "printing" | "ok" | "error">(
    "idle",
  );

  async function printDirect() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      router.push("/pos/printer");
      return;
    }

    try {
      const config = JSON.parse(raw) as { url: string; token: string };
      setState("printing");

      const raster = await buildRasterTicket(ticket, template);

      const response = await fetch(
        config.url.replace(/\/$/, "") + "/print",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Cafe-Epico-Token": config.token,
          },
          body: JSON.stringify({
            raster,
            feed: template.feedLines,
            cut: template.autoCut,
          }),
        },
      );

      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "No se pudo imprimir");
      }

      setState("ok");
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      className="button no-print"
      onClick={printDirect}
      disabled={state === "printing"}
    >
      {state === "printing"
        ? "Renderizando e imprimiendo…"
        : state === "ok"
          ? "Impreso ✓"
          : state === "error"
            ? "Error · configurar"
            : "Imprimir directo ESC/POS"}
    </button>
  );
}
