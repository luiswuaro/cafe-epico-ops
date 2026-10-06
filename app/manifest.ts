import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Café Épico Ops",
    short_name: "Épico Ops",
    description: "Operación, recetas, inventario y SOPs de Café Épico.",
    start_url: "/today",
    display: "standalone",
    background_color: "#f7f3ec",
    theme_color: "#171717",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
