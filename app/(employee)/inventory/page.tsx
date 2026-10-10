import { redirect } from "next/navigation";

// OPS es la única fuente de existencias. La ruta histórica de Loyverse
// redirige al inventario interno; nunca muestra saldos antiguos.
export default function InventoryPage() {
  redirect("/inventory/ops");
}
