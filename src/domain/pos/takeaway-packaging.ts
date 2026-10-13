/** Presentación obligatoria por producto y modalidad de servicio. */
type SaleProduct = { name: string; category: string };
type RecipePart = { name: string };

const normalized = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();

/** El espresso de Café Épico se entrega en vaso de 4 oz sin tapa. */
export function isEspressoTakeawayWithoutLid(product: SaleProduct): boolean {
  return product.category === "CALIENTES" && normalized(product.name) === "ESPRESSO";
}

export function takeawayPackagingErrors(
  product: SaleProduct,
  components: RecipePart[],
): string[] {
  if (product.category !== "CALIENTES" && product.category !== "FRÍAS") return [];

  const names = components.map(part => normalized(part.name));
  const hasCup = names.some(name => /\bVASO\b/.test(name));
  const hasLid = names.some(name => /\bTAPA\b/.test(name));
  const errors: string[] = [];

  if (!hasCup) errors.push("Falta vaso para llevar.");
  if (isEspressoTakeawayWithoutLid(product)) {
    if (!names.some(name => /\bVASO\b.*\b4\s*OZ\b/.test(name)))
      errors.push("El espresso para llevar requiere vaso de 4 oz.");
    if (hasLid) errors.push("El espresso para llevar no utiliza tapa.");
  } else if (!hasLid) {
    errors.push("Falta tapa para llevar.");
  }

  return errors;
}
