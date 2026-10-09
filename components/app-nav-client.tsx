"use client";

export function AppNavClient({canAdmin,canPos,canCash}:{canAdmin:boolean;canPos:boolean;canCash:boolean}) {
  return <nav aria-label="Menú"><a href="/today">Hoy</a><a href="/pos">POS</a><a href="/pos/orders">Comandas</a></nav>;
}
