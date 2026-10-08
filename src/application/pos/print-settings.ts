import { eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { posPrintSettings } from "@/src/infrastructure/db/schema";

export type PosPrintSettings = {
  businessName: string;
  addressLine: string;
  phoneLine: string | null;
  socialLine: string | null;
  headerMessage: string | null;
  footerMessage: string;
  showLogo: boolean;
  logoDataUrl: string | null;
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

export const defaultPosPrintSettings: PosPrintSettings = {
  businessName: "Café Épico",
  addressLine: "Tepexi de Rodríguez, Puebla",
  phoneLine: null,
  socialLine: null,
  headerMessage: null,
  footerMessage: "Gracias por tu visita.",
  showLogo: false,
  logoDataUrl: null,
  logoRasterBase64: null,
  logoWidthPx: null,
  logoHeightPx: null,
  logoAlign: "center",
  showBusinessName: true,
  showAddress: true,
  showPhone: false,
  showSocial: false,
  showFolio: true,
  showDate: true,
  showEmployee: true,
  showService: true,
  showCustomer: true,
  showPoints: true,
  showItemNotes: true,
  showNoCfdi: true,
  lineWidthChars: 32,
  feedLines: 3,
  autoCut: false,
};

export async function getPosPrintSettings(
  organizationId: string,
): Promise<PosPrintSettings> {
  const [row] = await getDb()
    .select()
    .from(posPrintSettings)
    .where(eq(posPrintSettings.organizationId, organizationId))
    .limit(1);

  if (!row) return defaultPosPrintSettings;

  const align =
    row.logoAlign === "left" || row.logoAlign === "right"
      ? row.logoAlign
      : "center";

  return {
    businessName: row.businessName,
    addressLine: row.addressLine,
    phoneLine: row.phoneLine,
    socialLine: row.socialLine,
    headerMessage: row.headerMessage,
    footerMessage: row.footerMessage,
    showLogo: row.showLogo,
    logoDataUrl: row.logoDataUrl,
    logoRasterBase64: row.logoRasterBase64,
    logoWidthPx: row.logoWidthPx,
    logoHeightPx: row.logoHeightPx,
    logoAlign: align,
    showBusinessName: row.showBusinessName,
    showAddress: row.showAddress,
    showPhone: row.showPhone,
    showSocial: row.showSocial,
    showFolio: row.showFolio,
    showDate: row.showDate,
    showEmployee: row.showEmployee,
    showService: row.showService,
    showCustomer: row.showCustomer,
    showPoints: row.showPoints,
    showItemNotes: row.showItemNotes,
    showNoCfdi: row.showNoCfdi,
    lineWidthChars: Math.max(24, Math.min(42, row.lineWidthChars)),
    feedLines: Math.max(1, Math.min(8, row.feedLines)),
    autoCut: row.autoCut,
  };
}
