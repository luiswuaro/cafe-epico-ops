# Integración de la antena — domingo 18/oct/2026

**Situación:** Café Épico OPS sigue comercial en Vercel/Supabase.
La rama \`feat/local-selfhost-qa-bootstrap\` es solo de pruebas; no modificar
la caja en producción durante la instalación de la antena.

## 1. Antena y red: primero dos celulares, sin tocar POS

1. Apagar Windows antes de conectar las antenas RF. Confirmar
   compatibilidad de conectores/bandas Wi-Fi del adaptador; no sustituir
   antenas de Wi-Fi por antenas LoRa de distinta banda.
2. Encender la PC; conectar el adaptador Wi-Fi propio a la red del hotel.
   Dejar la tablet por USB conectada como respaldo de internet comercial.
3. En PowerShell de la copia **QA** del repositorio:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\check-windows.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\test-lan.ps1

4. El script mostrará todas las IPs privadas y escogerá la interfaz Wi-Fi,
   NO la de USB si ambas están presentes. Mostrará una dirección como
   \`http://192.168.x.y:47835/\`, con la IP real de la PC.
5. Apagar datos móviles de **dos teléfonos** y conectarlos al mismo SSID.
   Abrir esa URL en **ambos teléfonos**. Debe leerse
   \`CONEXIÓN LOCAL CONFIRMADA\`.
6. Si el firewall de Windows bloquea, repetir como Administrador:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\test-lan.ps1 -OpenTemporaryFirewall

   Abre **solo** la IP Wi-Fi elegida, puerto TCP 47835, desde \`LocalSubnet\`,
   y elimina la regla temporal al terminar. No desactivar el firewall general.
   Si Windows no reconoce el nombre de Wi-Fi, pasar
   \`-InterfaceAlias "NOMBRE_DE_LA_LISTA"\`.
7. Si el móvil sigue sin conectar, puede ser aislamiento AP, red de invitados
   o VLAN del hotel. Comprar la antena no quita ese aislamiento: necesitaríamos
   autorización para cambiar la red o una LAN/Wi-Fi administrada por la cafetería.

**Resultado mínimo:** PC y dos teléfonos comunicándose sin usar la nube,
sin contraseñas ni compras. La prueba no abre OPS ni usa datos reales.

## 2. Preparar QA sin tocar la carpeta del POS comercial

Si hace falta clonar una copia aparte del proyecto:

    git clone --branch feat/local-selfhost-qa-bootstrap --single-branch https://github.com/luiswuaro/cafe-epico-ops.git cafe-epico-ops-qa
    cd cafe-epico-ops-qa

No hacer \`git checkout\` ni \`git pull\` en un árbol activo durante cobros.

Con la antena probada, seguir \`docs/operations/selfhost-qa-bootstrap.md\`
para el stack local: Git, Node 22, Docker Desktop/WSL2, Supabase Auth/PostgreSQL
QA, Caddy HTTPS y Next.js por 127.0.0.1:3000. Las claves QA son nuevas y
nunca deben copiarse de Supabase productivo.

Los celulares deben usar HTTPS de Caddy en la IP de Wi-Fi y confiar la
**CA pública** de Caddy. Nunca abrir 3000, 5432, 6543, 8000, ni 9137/9138
directamente al hotel.

## 3. QA de POS, impresión y sin internet

1. Verificar \`node --env-file=.env.local scripts/local/qa-smoke.mjs\` con
   PostgreSQL y Auth locales operativos.
2. Usar una cuenta Auth QA vinculada a empleado de prueba. Crear venta
   ficticia, ticket para llevar y para aquí, cuenta dividida, puntos,
   inventario y segunda ronda desde dos teléfonos.
3. Activar el agente QA de impresión solo con
   \`NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED=true\`; probar papel con
   \`create-print-agent-qa-order.mjs --print-qa-fixture\`, comanda de $0
   sin movimientos de inventario o puntos. Validar logo, acentos, notas y
   ausencia de doble papel.
4. Verificar funcionamiento sin salida a internet **manteniendo el Wi-Fi
   encendido**. No usar modo avión ni desactivar la antena: eso cortaría
   también la LAN.
5. Detener/reiniciar agente y QA; verificar que no hay tickets duplicados ni
   saldos de cliente alterados.
6. Ejecutar backup cifrado y **restaurar en una segunda base aislada**;
   conciliar historial, puntos, caja, usuarios y movimientos de inventario.

## Semáforo de autorización

| Control | Para avanzar |
|---|---|
| IP privada Wi-Fi propia | Confirmada |
| PC accesible desde dos móviles | Ambos muestran la prueba |
| Auth + PostgreSQL local | QA smoke completo sin nube |
| Dos móviles simultáneos | Tickets y pagos ficticios consistentes |
| Bridge POS-58 | Papel correcto, no duplicado |
| Cortar WAN, conservar LAN | Operación completa |
| Backup/restauración | Saldos conciliados en otra copia |
| Datos comerciales | No migrar hasta todos los controles anteriores |

**No hacer corte productivo durante las pruebas.** La tablet USB puede
seguir alimentando la versión comercial mientras se valida la red local.
