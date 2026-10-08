"use client";

import { useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "cafe-epico-printer-bridge-v1";
const STORAGE_EVENT = "cafe-epico-printer-bridge-changed";

type StoredConfig = {
  url: string;
  token: string;
};

function subscribeToStoredConfig(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(STORAGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(STORAGE_EVENT, callback);
  };
}

function getStoredConfigSnapshot() {
  return window.localStorage.getItem(STORAGE_KEY) ?? "";
}

function parseStoredConfig(raw: string): StoredConfig | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    if (!parsed.url || !parsed.token) return null;

    return {
      url: parsed.url,
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

async function requestBridge(
  url: string,
  token: string,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(url.replace(/\/$/, "") + path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "X-Cafe-Epico-Token": token,
    },
  });

  const data = (await response.json()) as {
    ok?: boolean;
    printer?: string;
    error?: string;
    graphics?: boolean;
    fullTicketRaster?: boolean;
    version?: string;
  };

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "No respondió el puente local");
  }

  return data;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;

  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }

  return btoa(binary);
}

function buildAccentTestRaster() {
  const width = 384;
  const height = 260;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No se pudo crear la prueba gráfica");

  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#000";
  context.textAlign = "center";
  context.textBaseline = "top";

  context.font = "900 31px Arial, Helvetica, sans-serif";
  context.fillText("Café Épico", width / 2, 18);

  context.font = "700 22px Arial, Helvetica, sans-serif";
  context.fillText("Tepexi de Rodríguez, Puebla", width / 2, 62);
  context.fillText("á é í ó ú · ñ · ¿? · ¡!", width / 2, 96);

  context.font = "900 22px Arial, Helvetica, sans-serif";
  context.fillText("IMPRESIÓN GRÁFICA OK", width / 2, 136);

  context.font = "700 19px Arial, Helvetica, sans-serif";
  context.fillText("Sin tabla de caracteres ESC/POS", width / 2, 176);
  context.fillText("Si los acentos salen bien, quedó resuelto.", width / 2, 205);

  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const widthBytes = Math.ceil(width / 8);
  const packed = new Uint8Array(widthBytes * height);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      const luminance =
        0.2126 * pixels[offset] +
        0.7152 * pixels[offset + 1] +
        0.0722 * pixels[offset + 2];

      if (luminance < 190) {
        const byteIndex = row * widthBytes + Math.floor(column / 8);
        packed[byteIndex] |= 0x80 >> (column % 8);
      }
    }
  }

  return {
    dataBase64: encodeBase64(packed),
    width,
    height,
    align: "center" as const,
  };
}

export function PrinterBridgeSetup() {
  const storedRaw = useSyncExternalStore(
    subscribeToStoredConfig,
    getStoredConfigSnapshot,
    () => "",
  );
  const stored = parseStoredConfig(storedRaw);

  const [urlOverride, setUrlOverride] = useState<string | null>(null);
  const [tokenOverride, setTokenOverride] = useState<string | null>(null);
  const [status, setStatus] = useState(
    stored ? "Configuración guardada en esta computadora" : "Sin configurar",
  );
  const [printer, setPrinter] = useState<string | null>(null);

  const url = urlOverride ?? stored?.url ?? "http://127.0.0.1:9137";
  const token = tokenOverride ?? stored?.token ?? "";

  function saveLocally() {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        url: url.replace(/\/$/, ""),
        token,
      } satisfies StoredConfig),
    );
    window.dispatchEvent(new Event(STORAGE_EVENT));
    setUrlOverride(null);
    setTokenOverride(null);
  }

  async function testAndSave() {
    setStatus("Probando conexión…");

    try {
      const data = await requestBridge(url, token, "/status");
      saveLocally();
      setPrinter(data.printer ?? "impresora térmica");
      setStatus(
        "Conectado · " +
          (data.printer || "impresora térmica") +
          (data.fullTicketRaster ? " · ticket gráfico OK" : " · gráficos OK"),
      );
    } catch (error) {
      setPrinter(null);
      setStatus(
        "Error · " +
          (error instanceof Error ? error.message : "sin conexión"),
      );
    }
  }

  async function printTest() {
    setStatus("Renderizando prueba con acentos…");

    try {
      const raster = buildAccentTestRaster();
      const data = await requestBridge(url, token, "/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raster,
          feed: 3,
          cut: false,
        }),
      });

      saveLocally();
      setPrinter(data.printer ?? "impresora térmica");
      setStatus(
        "Prueba gráfica enviada · " +
          (data.printer || "impresora térmica"),
      );
    } catch (error) {
      setStatus(
        "Error · " +
          (error instanceof Error ? error.message : "no se pudo imprimir"),
      );
    }
  }

  return (
    <div className="stack">
      {stored && tokenOverride === null && (
        <div className="printer-bridge-status printer-bridge-ok">
          Configuración local recuperada automáticamente.
        </div>
      )}

      <label>
        URL del puente local
        <input
          value={url}
          onChange={(event) => setUrlOverride(event.target.value)}
          inputMode="url"
        />
      </label>

      <label>
        Token local
        <input
          value={token}
          onChange={(event) => setTokenOverride(event.target.value)}
          autoComplete="off"
          type="password"
        />
      </label>

      <div className="printer-bridge-actions">
        <button
          type="button"
          onClick={testAndSave}
          disabled={!token.trim()}
        >
          Probar y guardar en esta computadora
        </button>
        <button
          type="button"
          onClick={printTest}
          disabled={!token.trim()}
        >
          Imprimir prueba de acentos
        </button>
      </div>

      <div
        className={
          "printer-bridge-status " +
          (printer ? "printer-bridge-ok" : "")
        }
      >
        {status}
      </div>
    </div>
  );
}

export const printerBridgeStorageKey = STORAGE_KEY;
