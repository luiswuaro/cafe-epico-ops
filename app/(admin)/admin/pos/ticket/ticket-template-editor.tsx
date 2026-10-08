"use client";

import { useMemo, useState } from "react";
import { savePosPrintSettings } from "./actions";

type Settings = {
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

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function prepareThermalLogo(file: File) {
  if (file.size > 5_000_000) {
    throw new Error("El archivo supera 5 MB");
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Formato de imagen no compatible"));
    img.onload = () => resolve(img);
    img.src = dataUrl;
  });

  const maxWidth = 320;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const width = Math.max(8, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  if (height > 500) {
    throw new Error("El logo es demasiado alto para un ticket");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No se pudo procesar el logo");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const widthBytes = Math.ceil(width / 8);
  const packed = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3] / 255;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const luminance =
        (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha +
        255 * (1 - alpha);

      if (luminance < 168) {
        const byteIndex = y * widthBytes + Math.floor(x / 8);
        packed[byteIndex] |= 0x80 >> (x % 8);
      }
    }
  }

  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = width;
  previewCanvas.height = height;
  const previewContext = previewCanvas.getContext("2d");
  if (!previewContext) throw new Error("No se pudo generar la vista previa");

  previewContext.fillStyle = "#fff";
  previewContext.fillRect(0, 0, width, height);
  previewContext.fillStyle = "#000";
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const byteIndex = y * widthBytes + Math.floor(x / 8);
      if ((packed[byteIndex] & (0x80 >> (x % 8))) !== 0) {
        previewContext.fillRect(x, y, 1, 1);
      }
    }
  }

  return {
    dataUrl: previewCanvas.toDataURL("image/png"),
    rasterBase64: toBase64(packed),
    width,
    height,
  };
}

function Toggle({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="ticket-toggle">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function TicketTemplateEditor({
  initial,
}: {
  initial: Settings;
}) {
  const [settings, setSettings] = useState(initial);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const previewLines = useMemo(
    () => [
      { name: "2× Latte Español", total: "$120.00", note: "Deslactosada" },
      { name: "1× Pan Solo", total: "$15.00", note: null },
    ],
    [],
  );

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function onLogo(file: File | null) {
    if (!file) return;
    setLogoBusy(true);
    setLogoError(null);

    try {
      const logo = await prepareThermalLogo(file);
      setSettings((current) => ({
        ...current,
        logoDataUrl: logo.dataUrl,
        logoRasterBase64: logo.rasterBase64,
        logoWidthPx: logo.width,
        logoHeightPx: logo.height,
        showLogo: true,
      }));
    } catch (error) {
      setLogoError(
        error instanceof Error ? error.message : "No se pudo procesar el logo",
      );
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <form action={savePosPrintSettings} className="ticket-template-layout">
      <input type="hidden" name="logoDataUrl" value={settings.logoDataUrl ?? ""} />
      <input
        type="hidden"
        name="logoRasterBase64"
        value={settings.logoRasterBase64 ?? ""}
      />
      <input type="hidden" name="logoWidthPx" value={settings.logoWidthPx ?? ""} />
      <input
        type="hidden"
        name="logoHeightPx"
        value={settings.logoHeightPx ?? ""}
      />

      <div className="stack">
        <section className="card">
          <p className="eyebrow">IDENTIDAD</p>
          <h2>Encabezado del ticket</h2>

          <div className="form-grid">
            <label>
              Nombre del negocio
              <input
                name="businessName"
                value={settings.businessName}
                onChange={(event) => patch("businessName", event.target.value)}
                required
              />
            </label>
            <label>
              Dirección / sucursal
              <input
                name="addressLine"
                value={settings.addressLine}
                onChange={(event) => patch("addressLine", event.target.value)}
              />
            </label>
            <label>
              Teléfono
              <input
                name="phoneLine"
                value={settings.phoneLine ?? ""}
                onChange={(event) =>
                  patch("phoneLine", event.target.value || null)
                }
              />
            </label>
            <label>
              Redes / usuario
              <input
                name="socialLine"
                value={settings.socialLine ?? ""}
                onChange={(event) =>
                  patch("socialLine", event.target.value || null)
                }
                placeholder="@cafe.epico1"
              />
            </label>
          </div>

          <label>
            Mensaje superior opcional
            <input
              name="headerMessage"
              value={settings.headerMessage ?? ""}
              onChange={(event) =>
                patch("headerMessage", event.target.value || null)
              }
              placeholder="Café de calidad"
            />
          </label>

          <div className="ticket-logo-editor">
            <div>
              <strong>Logo térmico</strong>
              <p className="muted">
                OPS lo convierte automáticamente a blanco y negro y máximo
                320 px para la POS-58.
              </p>
            </div>

            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => onLogo(event.target.files?.[0] ?? null)}
              disabled={logoBusy}
            />

            {logoError && <p className="status-bad">{logoError}</p>}

            {settings.logoDataUrl && (
              <div className="ticket-logo-current">
                <img src={settings.logoDataUrl} alt="Vista previa del logo" />
                <div className="stack compact-stack">
                  <span className="muted">
                    {settings.logoWidthPx}×{settings.logoHeightPx} px
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        showLogo: false,
                        logoDataUrl: null,
                        logoRasterBase64: null,
                        logoWidthPx: null,
                        logoHeightPx: null,
                      }))
                    }
                  >
                    Quitar logo
                  </button>
                </div>
              </div>
            )}

            <div className="form-grid">
              <Toggle
                name="showLogo"
                label="Mostrar logo"
                checked={settings.showLogo}
                onChange={(value) => patch("showLogo", value)}
              />
              <label>
                Alineación
                <select
                  name="logoAlign"
                  value={settings.logoAlign}
                  onChange={(event) =>
                    patch(
                      "logoAlign",
                      event.target.value as Settings["logoAlign"],
                    )
                  }
                >
                  <option value="left">Izquierda</option>
                  <option value="center">Centro</option>
                  <option value="right">Derecha</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="card">
          <p className="eyebrow">COMPOSICIÓN</p>
          <h2>Qué aparece en el ticket</h2>

          <div className="ticket-toggle-grid">
            <Toggle name="showBusinessName" label="Nombre del negocio" checked={settings.showBusinessName} onChange={(v) => patch("showBusinessName", v)} />
            <Toggle name="showAddress" label="Dirección" checked={settings.showAddress} onChange={(v) => patch("showAddress", v)} />
            <Toggle name="showPhone" label="Teléfono" checked={settings.showPhone} onChange={(v) => patch("showPhone", v)} />
            <Toggle name="showSocial" label="Redes" checked={settings.showSocial} onChange={(v) => patch("showSocial", v)} />
            <Toggle name="showFolio" label="Folio" checked={settings.showFolio} onChange={(v) => patch("showFolio", v)} />
            <Toggle name="showDate" label="Fecha y hora" checked={settings.showDate} onChange={(v) => patch("showDate", v)} />
            <Toggle name="showEmployee" label="Empleado" checked={settings.showEmployee} onChange={(v) => patch("showEmployee", v)} />
            <Toggle name="showService" label="Mesa / servicio" checked={settings.showService} onChange={(v) => patch("showService", v)} />
            <Toggle name="showCustomer" label="Cliente" checked={settings.showCustomer} onChange={(v) => patch("showCustomer", v)} />
            <Toggle name="showPoints" label="Puntos" checked={settings.showPoints} onChange={(v) => patch("showPoints", v)} />
            <Toggle name="showItemNotes" label="Notas por producto" checked={settings.showItemNotes} onChange={(v) => patch("showItemNotes", v)} />
            <Toggle name="showNoCfdi" label="Aviso no CFDI" checked={settings.showNoCfdi} onChange={(v) => patch("showNoCfdi", v)} />
          </div>

          <label>
            Mensaje final
            <input
              name="footerMessage"
              value={settings.footerMessage}
              onChange={(event) => patch("footerMessage", event.target.value)}
            />
          </label>
        </section>

        <section className="card">
          <p className="eyebrow">IMPRESIÓN ESC/POS</p>
          <h2>Ancho y avance</h2>

          <div className="form-grid">
            <label>
              Caracteres por línea
              <input
                name="lineWidthChars"
                type="number"
                min={24}
                max={42}
                value={settings.lineWidthChars}
                onChange={(event) =>
                  patch("lineWidthChars", Number(event.target.value))
                }
              />
            </label>
            <label>
              Líneas de avance al terminar
              <input
                name="feedLines"
                type="number"
                min={1}
                max={8}
                value={settings.feedLines}
                onChange={(event) =>
                  patch("feedLines", Number(event.target.value))
                }
              />
            </label>
          </div>

          <Toggle
            name="autoCut"
            label="Enviar comando de corte automático"
            checked={settings.autoCut}
            onChange={(value) => patch("autoCut", value)}
          />
          <p className="muted">
            Déjalo apagado si tu POS-58 no tiene cortador automático.
          </p>
        </section>

        <button type="submit" className="ticket-save-button">
          Guardar plantilla
        </button>
      </div>

      <aside className="ticket-preview-column">
        <div className="ticket-preview-sticky">
          <p className="eyebrow">VISTA PREVIA</p>
          <div className="ticket-preview-paper">
            {settings.showLogo && settings.logoDataUrl && (
              <div className={"ticket-preview-logo " + settings.logoAlign}>
                <img src={settings.logoDataUrl} alt="" />
              </div>
            )}
            {settings.showBusinessName && (
              <h3>{settings.businessName || "Café Épico"}</h3>
            )}
            {settings.showAddress && settings.addressLine && (
              <p>{settings.addressLine}</p>
            )}
            {settings.showPhone && settings.phoneLine && (
              <p>{settings.phoneLine}</p>
            )}
            {settings.showSocial && settings.socialLine && (
              <p>{settings.socialLine}</p>
            )}
            {settings.headerMessage && <p>{settings.headerMessage}</p>}

            <hr />
            {settings.showFolio && <p>Folio: SH-261007-ABCD</p>}
            {settings.showDate && <p>Fecha: 07/10/26 · 18:42</p>}
            {settings.showEmployee && <p>Atendió: Azucena</p>}
            {settings.showService && <p>Servicio: Mesa 3</p>}
            <hr />

            {previewLines.map((line) => (
              <div key={line.name} className="ticket-preview-product">
                <div>
                  <strong>{line.name}</strong>
                  <strong>{line.total}</strong>
                </div>
                {settings.showItemNotes && line.note && (
                  <span>↳ {line.note}</span>
                )}
              </div>
            ))}

            <hr />
            <div className="ticket-preview-total">
              <strong>TOTAL</strong>
              <strong>$135.00</strong>
            </div>
            <p>Pago: EFECTIVO</p>

            {settings.showCustomer && <p>Cliente: María López</p>}
            {settings.showPoints && (
              <>
                <p>Puntos ganados: +6.75</p>
                <p>Saldo: 42.50 pts</p>
              </>
            )}

            <hr />
            <p className="center">
              <strong>{settings.footerMessage}</strong>
            </p>
            {settings.showNoCfdi && (
              <p className="center">Este ticket no es CFDI.</p>
            )}
          </div>
        </div>
      </aside>
    </form>
  );
}
