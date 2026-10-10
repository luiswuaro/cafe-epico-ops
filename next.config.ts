import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // HiBean genera exportaciones JSON superiores al límite predeterminado de 1 MB
  // en Server Actions. Vercel limita el request a 4.5 MB; la UI restringe
  // el archivo a 3.5 MB para reservar cabeceras/multipart.
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
