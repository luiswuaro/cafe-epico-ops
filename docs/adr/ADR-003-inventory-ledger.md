# ADR-003: Ledger inmutable de inventario
**Estado:** Aceptado

Todo cambio teórico crea `inventory_movements`. `inventory_balances` es una proyección. Los conteos físicos generan desviación y requieren un movimiento separado si se aprueba ajuste.
