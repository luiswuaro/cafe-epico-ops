"use client";

import { useState } from "react";

const STORAGE_KEY = "cafe-epico-printer-bridge-v1";

type StoredConfig = {
  url: string;
  token: string;
};

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
  };

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "No respondió el puente local");
  }

  return data;
}

export function PrinterBridgeSetup() {
  const [url, setUrl] = useState("http://127.0.0.1:9137");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Sin probar");
  const [printer, setPrinter] = useState<string | null>(null);

  async function testAndSave() {
    setStatus("Probando conexión…");
    try {
      const data = await requestBridge(url, token, "/status");
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          url: url.replace(/\/$/, ""),
          token,
        } satisfies StoredConfig),
      );
      setPrinter(data.printer ?? "impresora térmica");
      setStatus(
        "Conectado · " +
          (data.printer || "impresora térmica") +
          (data.graphics ? " · gráficos OK" : ""),
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
    setStatus("Imprimiendo prueba…");
    try {
      const data = await requestBridge(url, token, "/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: [
            {
              text: "CAFE EPICO",
              align: "center",
              bold: true,
              size: "double",
            },
            {
              text: "Prueba ESC/POS",
              align: "center",
              bold: true,
            },
            { text: "--------------------------------" },
            { text: "Impresion directa sin Chrome" },
            { text: "Si lees esto, el puente funciona.", bold: true },
          ],
          feed: 3,
          cut: false,
        }),
      });

      setPrinter(data.printer ?? "impresora térmica");
      setStatus("Prueba enviada · " + (data.printer || "impresora"));
    } catch (error) {
      setStatus(
        "Error · " +
          (error instanceof Error ? error.message : "no se pudo imprimir"),
      );
    }
  }

  return (
    <div className="stack">
      <label>
        URL del puente local
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          inputMode="url"
        />
      </label>
      <label>
        Token mostrado por el instalador
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
        />
      </label>
      <div className="printer-bridge-actions">
        <button type="button" onClick={testAndSave}>
          Probar y guardar en esta computadora
        </button>
        <button
          type="button"
          onClick={printTest}
          disabled={!token.trim()}
        >
          Imprimir ticket de prueba
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
