"use client";

import { useState, useSyncExternalStore } from "react";
import { AUTO_KITCHEN_DINE_IN_KEY, AUTO_KITCHEN_TAKEAWAY_KEY, KITCHEN_SETTINGS_EVENT } from "../orders/kitchen-print-settings";

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
    rasterBands?: boolean;
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
          " · puente v"+(data.version||"desconocida")+
          (data.rasterBands
            ?" · impresión gráfica por bandas lista"
            :" · ACTUALIZACIÓN REQUERIDA para comandas (v1.3.0)"),
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
      const bridge=await requestBridge(url,token,"/status");
      if(!bridge.rasterBands)
        throw new Error("Actualiza el puente a v1.3.0 para imprimir gráficos de forma segura.");
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

const KITCHEN_BRIDGE_KEY="cafe-epico-kitchen-printer-bridge-v1";
const KITCHEN_ROUTE_KEY="cafe-epico-kitchen-route-v1";

function readKitchenRoute() {
  return window.localStorage.getItem(KITCHEN_ROUTE_KEY) || "tickets";
}
function readKitchenBridge() {
  return window.localStorage.getItem(KITCHEN_BRIDGE_KEY) ?? "";
}

export function KitchenPrinterSetup() {
  const route=useSyncExternalStore(
    subscribeToStoredConfig,readKitchenRoute,()=>"tickets",
  );
  const stored=useSyncExternalStore(
    subscribeToStoredConfig,readKitchenBridge,()=>"");
  const config=parseStoredConfig(stored);
  const [url,setUrl]=useState<string|null>(null);
  const [token,setToken]=useState<string|null>(null);
  const [status,setStatus]=useState("");
  const shownUrl=url??config?.url??"http://127.0.0.1:9138";
  const shownToken=token??config?.token??"";
  const notify=()=>window.dispatchEvent(new Event(STORAGE_EVENT));

  function selectTickets(){
    window.localStorage.setItem(KITCHEN_ROUTE_KEY,"tickets");
    notify();
    setStatus("Las comandas se imprimirán en la misma impresora de tickets.");
  }
  async function activateSeparate(){
    setStatus("Validando segunda impresora…");
    if(!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/?$/.test(shownUrl)) {
      setStatus("Usa una dirección local del puente, por ejemplo http://127.0.0.1:9138");
      return;
    }
    try{
      const result=await requestBridge(shownUrl,shownToken,"/status");
      if(!result.rasterBands)
        throw new Error("Actualiza el puente de barra a v1.3.0 antes de activarlo.");
      window.localStorage.setItem(KITCHEN_BRIDGE_KEY,JSON.stringify({
        url:shownUrl.replace(/\/$/,""),token:shownToken,
      } satisfies StoredConfig));
      window.localStorage.setItem(KITCHEN_ROUTE_KEY,"separate");
      notify();
      setUrl(null);setToken(null);
      setStatus("Impresora de barra vinculada: "+(result.printer??"térmica"));
    }catch(e){
      setStatus("No se activó: "+(e instanceof Error?e.message:"sin respuesta del puente"));
    }
  }
  return <div className="stack kitchen-printer-setup">
    <p><strong>Destino actual: {route==="separate"?"Impresora exclusiva de barra":"Misma impresora de tickets"}</strong></p>
    <p className="muted">La selección se guarda sólo en este navegador. Ninguna configuración de impresión afecta las recetas ni la caja.</p>
    <label className="kitchen-printer-route">
      <input type="radio" name="kitchenPrintDestination" checked={route!=="separate"}
        onChange={selectTickets}/>
      <span><strong>Usar impresora de tickets</strong><small className="muted">Usa el puerto 9137 y el token que ya configuraste.</small></span>
    </label>
    <div className="card stack">
      <strong>Otra impresora de comandas (opcional)</strong>
      <p className="muted">Instala el puente Barra en Windows con puerto 9138 e introduce su token local. La opción quedará activa sólo después de conectarse correctamente.</p>
      <label>URL del puente de barra
        <input type="url" value={shownUrl} onChange={e=>setUrl(e.target.value)}
          inputMode="url" autoComplete="off"/>
      </label>
      <label>Token de barra
        <input type="password" value={shownToken} onChange={e=>setToken(e.target.value)}
          autoComplete="off"/>
      </label>
      <button type="button" disabled={!shownToken.trim()} onClick={activateSeparate}>
        Probar y usar impresora de barra
      </button>
    </div>
    {status&&<p role="status" className="printer-bridge-status">{status}</p>}
  </div>;
}

function listenAutoKitchen(callback:()=>void){
  window.addEventListener("storage",callback);
  window.addEventListener(KITCHEN_SETTINGS_EVENT,callback);
  return ()=>{
    window.removeEventListener("storage",callback);
    window.removeEventListener(KITCHEN_SETTINGS_EVENT,callback);
  };
}
function getAutoDineIn(){return window.localStorage.getItem(AUTO_KITCHEN_DINE_IN_KEY)==="1";}
function getAutoTakeaway(){return window.localStorage.getItem(AUTO_KITCHEN_TAKEAWAY_KEY)==="1";}

export function AutoKitchenPrintSettings(){
  const dineIn=useSyncExternalStore(listenAutoKitchen,getAutoDineIn,()=>false);
  const takeaway=useSyncExternalStore(listenAutoKitchen,getAutoTakeaway,()=>false);
  function update(key:string,enabled:boolean){
    window.localStorage.setItem(key,enabled?"1":"0");
    window.dispatchEvent(new Event(KITCHEN_SETTINGS_EVENT));
  }
  return <div className="stack">
    <h2>Impresión automática de comandas</h2>
    <p className="muted">Ambas opciones están apagadas inicialmente y se guardan por computadora/navegador. Usan el destino seleccionado arriba (tickets o impresora de barra).</p>
    <label className="kitchen-printer-route">
      <input type="checkbox" checked={takeaway}
        onChange={event=>update(AUTO_KITCHEN_TAKEAWAY_KEY,event.target.checked)}/>
      <span><strong>Para llevar · al confirmar cobro</strong>
        <small className="muted">Imprime los productos para llevar una sola vez, sólo después de registrar el pago.</small>
      </span>
    </label>
    <label className="kitchen-printer-route">
      <input type="checkbox" checked={dineIn}
        onChange={event=>update(AUTO_KITCHEN_DINE_IN_KEY,event.target.checked)}/>
      <span><strong>Para aquí · al guardar o enviar comanda</strong>
        <small className="muted">Imprime sólo lo añadido en la ronda nueva; no repite la comanda al cobrar.</small>
      </span>
    </label>
    <p className="muted">La computadora con el puente local debe estar encendida y ser la estación donde guardes o cobres. Si el puente no responde, la venta o la comanda quedan registradas y puedes imprimir manualmente desde Comandas.</p>
  </div>;
}
