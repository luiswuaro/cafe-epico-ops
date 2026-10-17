# Vista previa visual del POS — QA local

**Estado:** herramienta de demostración **sin datos reales**. No es el
POS comercial y no es una simulación de API/impresora física.

## Ver interfaz

- En PC QA local con Next.js activo, abrir
  `https://IP_PRIVADA:8443/qa/pos-preview`.
- La ruta entrega **404** si no están simultáneamente activos
  `OPS_LOCAL_FIRST=true`, `OPS_QA_MODE=true`,
  `DEFAULT_ORGANIZATION_SLUG=cafe-epico-qa`,
  `POS_LIVE_ENABLED` diferente de `true`, y no es un despliegue Vercel.
- La maqueta también se entregó como HTML autónomo en la conversación.
  Ese archivo se abre en Chrome incluso **sin Internet ni antena**.
- Se utilizan el estilo de OPS (tonos crema/café), dimensiones de teléfono
  y precios de EJEMPLO, no lecturas del inventario ni del catálogo vivo.

## Recorrido sugerido (5 minutos)

1. Abrir POS y alternar Calientes, Frías y Alimentos.
2. Añadir Latte español frío $70 y Moka $60 (datos ilustrativos).
3. Guardar Mesa 1; abrir Comandas.
4. Dividir: asignar una unidad a Cuenta 1 y otra a Cuenta 2.
5. Seleccionar Cliente QA A (22.50 pts); canjear 20 en Cuenta 1.
   La muestra calcula **$50 de dinero + $20 de puntos**.
6. Seleccionar Cliente QA B; liquidar Cuenta 2 con dinero.
7. Ir a Clientes y comprobar que cada cliente solo recibe su cuenta,
   y que los puntos se otorgan al **5% del dinero realmente pagado**.

La simulación vive **en memoria del navegador**: recargar borra los datos;
ningún click envía solicitudes al servidor. El layout general de Next.js
puede cargar la navegación/autenticación normal de la app, pero **este módulo
de simulación** no ejecuta funciones de negocio, no usa `fetch`, ni escribe
en la base ni en almacenamiento del navegador. En esta ruta el worker
de impresión de navegador no se inicia.

## Pruebas automatizadas

`node --test scripts/local/qa-ui-preview-policy.test.mjs`
impide publicar la ruta sin guardias de QA o incorporar accidentalmente
`fetch`, server actions, WebSocket o persistencia local.

La UI real de ventas se sigue comprobando en
`docs/operations/local-qa-acceptance.md` cuando haya antena y stack QA.
Una compilación PASS o esta vista de práctica **no certifican cobros reales**.
