/**
 * HiBean JSON vía Server Action.
 * 1 MB es el límite predeterminado de Next; la app configura 4 MB.
 * Vercel limita la carga HTTP total a 4.5 MB, incluyendo multipart.
 */
export const MAX_HIBEAN_JSON_BYTES = 3_500_000;
export const MAX_HIBEAN_JSON_MB = 3.5;
