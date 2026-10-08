param(
  [string]$PrinterName = "POS-58 (copy 1)",
  [int]$Port = 9137,
  [string]$Token = "",
  [int]$EscPosCodePage = 2,
  [switch]$AutoCut
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = [guid]::NewGuid().ToString("N")
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class CafeEpicoRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static void Print(string printerName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

        try {
            var di = new DOCINFOA { pDocName = "Cafe Epico OPS", pDataType = "RAW" };
            if (!StartDocPrinter(hPrinter, 1, di))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try {
                if (!StartPagePrinter(hPrinter))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                try {
                    IntPtr unmanaged = Marshal.AllocCoTaskMem(bytes.Length);
                    try {
                        Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
                        Int32 written;
                        if (!WritePrinter(hPrinter, unmanaged, bytes.Length, out written) || written != bytes.Length)
                            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                    } finally { Marshal.FreeCoTaskMem(unmanaged); }
                } finally { EndPagePrinter(hPrinter); }
            } finally { EndDocPrinter(hPrinter); }
        } finally { ClosePrinter(hPrinter); }
    }
}
"@

function Set-Cors($response) {
  $response.Headers["Access-Control-Allow-Origin"] = "*"
  $response.Headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
  $response.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-Cafe-Epico-Token"
  $response.Headers["Access-Control-Allow-Private-Network"] = "true"
  $response.Headers["Cache-Control"] = "no-store"
}

function Send-Json($context, [int]$statusCode, $body) {
  $json = $body | ConvertTo-Json -Compress -Depth 8
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $context.Response.StatusCode = $statusCode
  $context.Response.ContentType = "application/json; charset=utf-8"
  Set-Cors $context.Response
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}

function Add-Bytes($list, [byte[]]$bytes) {
  foreach ($value in $bytes) { [void]$list.Add($value) }
}

function Add-Text($list, [string]$text, $encoding) {
  Add-Bytes $list ($encoding.GetBytes($text))
}

function Align-Code([string]$align) {
  switch ($align) {
    "center" { return 1 }
    "right"  { return 2 }
    default  { return 0 }
  }
}

function Add-RasterImage($list, $logo) {
  if ($null -eq $logo) { return }
  if ([string]::IsNullOrWhiteSpace([string]$logo.dataBase64)) { return }

  $width = [int]$logo.width
  $height = [int]$logo.height
  if ($width -lt 1 -or $width -gt 384 -or $height -lt 1 -or $height -gt 5000) {
    throw "Dimensiones de raster fuera de rango."
  }

  $data = [Convert]::FromBase64String([string]$logo.dataBase64)
  $widthBytes = [int][Math]::Ceiling($width / 8.0)
  $expected = $widthBytes * $height
  if ($data.Length -ne $expected) {
    throw "Raster de logo invalido."
  }

  $align = Align-Code ([string]$logo.align)
  Add-Bytes $list ([byte[]](27,97,[byte]$align))

  $xL = [byte]($widthBytes -band 255)
  $xH = [byte](($widthBytes -shr 8) -band 255)
  $yL = [byte]($height -band 255)
  $yH = [byte](($height -shr 8) -band 255)

  Add-Bytes $list ([byte[]](29,118,48,0,$xL,$xH,$yL,$yH))
  Add-Bytes $list $data
  Add-Bytes $list ([byte[]](10))
}

function Build-EscPos($payload) {
  $encoding = [Text.Encoding]::GetEncoding(850)
  $bytes = New-Object 'System.Collections.Generic.List[byte]'

  Add-Bytes $bytes ([byte[]](27,64))
  Add-Bytes $bytes ([byte[]](27,116,[byte]$EscPosCodePage))

  if ($null -ne $payload.raster) {
    Add-RasterImage $bytes $payload.raster
  } elseif ($null -ne $payload.logo) {
    Add-RasterImage $bytes $payload.logo
  }

  foreach ($line in @($payload.lines)) {
    $align = Align-Code ([string]$line.align)
    Add-Bytes $bytes ([byte[]](27,97,[byte]$align))
    if ($line.bold -eq $true) {
      Add-Bytes $bytes ([byte[]](27,69,1))
    } else {
      Add-Bytes $bytes ([byte[]](27,69,0))
    }
    if ([string]$line.size -eq "double") {
      Add-Bytes $bytes ([byte[]](29,33,17))
    } else {
      Add-Bytes $bytes ([byte[]](29,33,0))
    }
    Add-Text $bytes ([string]$line.text) $encoding
    Add-Bytes $bytes ([byte[]](10))
  }

  Add-Bytes $bytes ([byte[]](27,69,0))
  Add-Bytes $bytes ([byte[]](29,33,0))
  Add-Bytes $bytes ([byte[]](27,97,0))

  $feed = 3
  if ($null -ne $payload.feed) {
    $feed = [Math]::Max(1, [Math]::Min(8, [int]$payload.feed))
  }
  for ($i = 0; $i -lt $feed; $i++) {
    Add-Bytes $bytes ([byte[]](10))
  }

  if ($AutoCut -or $payload.cut -eq $true) {
    Add-Bytes $bytes ([byte[]](29,86,0))
  }

  return $bytes.ToArray()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host ""
Write-Host "Cafe Epico Print Bridge" -ForegroundColor Cyan
Write-Host "Impresora: $PrinterName"
Write-Host "URL local : http://127.0.0.1:$Port"
Write-Host "Token     : $Token" -ForegroundColor Yellow
Write-Host ""

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request

    if ($request.HttpMethod -eq "OPTIONS") {
      $context.Response.StatusCode = 204
      Set-Cors $context.Response
      $context.Response.Close()
      continue
    }

    $providedToken = $request.Headers["X-Cafe-Epico-Token"]
    if ($providedToken -ne $Token) {
      Send-Json $context 401 @{ ok = $false; error = "Token local invalido" }
      continue
    }

    if ($request.Url.AbsolutePath -eq "/status" -and $request.HttpMethod -eq "GET") {
      Send-Json $context 200 @{
        ok = $true
        printer = $PrinterName
        port = $Port
        mode = "RAW_ESC_POS"
        graphics = $true
        fullTicketRaster = $true
        version = "1.2.0"
      }
      continue
    }

    if ($request.Url.AbsolutePath -eq "/print" -and $request.HttpMethod -eq "POST") {
      try {
        $reader = New-Object IO.StreamReader($request.InputStream, $request.ContentEncoding)
        $body = $reader.ReadToEnd()
        $payload = $body | ConvertFrom-Json
        $hasRaster = $null -ne $payload.raster -and -not [string]::IsNullOrWhiteSpace([string]$payload.raster.dataBase64)
        $hasLines = $null -ne $payload.lines -and @($payload.lines).Count -gt 0
        if (-not $hasRaster -and -not $hasLines) {
          throw "El ticket no contiene raster ni lineas."
        }
        $raw = Build-EscPos $payload
        [CafeEpicoRawPrinter]::Print($PrinterName, $raw)
        Send-Json $context 200 @{ ok = $true; printer = $PrinterName; bytes = $raw.Length }
      }
      catch {
        Send-Json $context 500 @{ ok = $false; error = $_.Exception.Message }
      }
      continue
    }

    Send-Json $context 404 @{ ok = $false; error = "Ruta no encontrada" }
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
