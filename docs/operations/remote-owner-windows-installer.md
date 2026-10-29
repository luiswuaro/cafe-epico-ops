# Café Épico OPS: preparación de acceso remoto privado, V1

**Estado:** paquete de preparación verificado con pruebas Node; **sin prueba ejecutada en la PC Windows real ni acceso remoto activado**.

## Lo que se ha construido

- Un único script PowerShell para comprobar si la instalación LIVE está lista.
- Preflight **sin escritura**: comprueba configuración LIVE, URLs de Auth,
  CA pública de Caddy, escucha de puertos, HTTPS y protección de impresión.
- Un modo explícito `-InstalarConector`, sólo tras confirmar manualmente
  políticas privadas Cloudflare. Requiere administrador y token obtenido por
  el dueño. No modifica la aplicación ni la base de datos.
- Si falta un requisito, falla con mensaje y **no instala** el túnel.
- No se configura URL pública, DNS, reenvío de puertos del hotel, ni se
  comparte contraseña del OPS con Cloudflare.

## Uso de una sola orden en Windows

Extraer el ZIP en una carpeta cualquiera; abrir PowerShell en esa carpeta.

Diagnóstico (primero, como usuario habitual):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Preparar-AccesoRemoto-Epico.ps1
```

Cuando **Luis haya terminado de configurar y revisar personalmente** las
políticas Access/Gateway y los móviles, abrir PowerShell como administrador
en esa misma carpeta:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Preparar-AccesoRemoto-Epico.ps1 -InstalarConector
```

El segundo modo instala el cliente `cloudflared` desde WinGet si hace falta y
solicita de forma interactiva el token oficial del túnel creado en el panel.
**No enviar el token por chat, correo ni captura.** Cloudflare lo usa como
argumento de instalación del servicio Windows; por tanto, otros
administradores locales podrían observarlo brevemente en procesos y permanece
en la configuración protegida del servicio. Restringir acceso administrativo
a la PC y rotar el token si se sospecha exposición.

En caso de más de una carpeta con `.env.local`, usar `-OpsPath` con la ruta
**exacta** a `cafe-epico-ops-live`; el instalador no adivina una versión.

## Requisitos del panel Cloudflare (solo configuración inicial)

1. Crear cuenta/organización Cloudflare Zero Trust para Café Épico; revisar
   plan y términos vigentes. El nombre de organización crea el dominio de
   **identidad** de Cloudflare, pero no requiere un dominio propio para una
   ruta privada.
2. Activar MFA del proveedor de identidad; limitar **Device enrollment** a
   Luis y Mildrett y revisar los dispositivos aprobados.
3. Crear túnel administrado `EPICO-OPS-PRIVADO`, conectar mediante
   `cloudflared`, y añadir exclusivamente la ruta privada **`IP_OPS/32`**.
   El PowerShell mostrará la IP real a usar. No añadir `192.168.0.0/24`
   ni ninguna subred completa del hotel.
4. Crear aplicación Access `Self-hosted and private` con la IP exacta y
   puerto **TCP 8443**. Allow sólo para los dos dueños.
5. Activar Proxy TCP en Gateway; política de **bloqueo por defecto** para
   `IP_OPS/32`, seguida por la excepción de prioridad superior sólo para
   identidad/dispositivos permitidos con TCP 8443. Revisar orden efectivo.
   **Sin esta política no habilitar la ruta**: Cloudflare advierte que un
   dispositivo inscrito puede alcanzar rutas privadas sin filtro adicional.
6. Instalar Cloudflare One Client en cada móvil, inscribir con organización
   autorizada y ajustar Split Tunnels para incluir solamente `IP_OPS/32`
   más los destinos de autenticación necesarios.
7. Tras instalar el conector, probar con datos móviles el enlace
   `https://IP_OPS:8443/login` (misma URL que en LAN). Debe confiarse en la
   **CA pública** de Caddy en cada dispositivo; no desactivar comprobación TLS.
8. Probar además: móvil no autorizado bloqueado, puertos internos denegados,
   mismo inventario y ventas visibles, roles OPS, y LAN operativa con la WAN
   desconectada. No efectuar cobros remotos reales hasta pasar la matriz.

### Nota sobre versiones y conexión

El proyecto LIVE usa `.env.local` y Auth en `.local/supabase-live/.env` o en
la carpeta QA hermana (ruta que también usan los scripts de alta de empleados).
El comprobador **lee** esos archivos, pero sólo muestra el estado de
validación: no imprime tokens, contraseñas, claves, ni `.env` completos.

La IP del OPS podría colisionar con la red del teléfono fuera de la cafetería.
Si ocurre, resolver el enrutamiento antes de operar en remoto. No cambiar
`APP_ORIGIN`, Caddy o Supabase a ciegas: eso podría romper sesiones LAN.

Si falla la instalación del servicio o las políticas no pasan las pruebas,
deshabilitar Tunnel CIDR/Access en Cloudflare y detener `cloudflared` en
Windows; ello no requiere eliminar ni restaurar la base de datos.

## Evidencia requerida para declarar el acceso operativo

| Prueba | Resultado |
| --- | --- |
| Preflight en Windows LIVE | 100% OK, sin puertos internos expuestos |
| Access y Gateway | MFA, denegación a dispositivos ajenos y a otros puertos |
| WARP desde datos móviles | Login y consultas HTTPS, certificado validado |
| Auth local | Inicio/cierre de sesión sin cambio de URL externa |
| Móvil BARISTA no inscrito | Bloqueado antes de llegar al OPS |
| Pruebas de mesa, ronda y cobro | Sin duplicados de ticket, pago o impresión |
| WAN caída, LAN disponible | Venta local continua por Caddy/PostgreSQL |
| Token revocado | Túnel deja de ser utilizable |

## Documentación de proveedores

- Cloudflare conexión privada `/32`: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-cidr/
- Cloudflare Access privada por IP y puerto: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/self-hosted-private-app/
- Cloudflare Split Tunnels: https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/route-traffic/split-tunnels/
- Cloudflare Windows Tunnel: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/
- Supabase Auth self-hosted URL: https://supabase.com/docs/guides/self-hosting/auth/config
