const BASE_URL = "https://api.loyverse.com/v1.0";

type QueryValue = string | number | boolean | undefined | null;

export class LoyverseClient {
  constructor(private readonly accessToken: string) {
    if (!accessToken) throw new Error("Loyverse access token is required");
  }

  async get<T>(path: string, query: Record<string, QueryValue> = {}): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Loyverse ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  async *paginate<T>(path: string, collectionKey: string, query: Record<string, QueryValue> = {}) {
    let cursor: string | undefined;
    do {
      const page = await this.get<Record<string, unknown>>(path, { ...query, cursor, limit: 250 });
      const rows = page[collectionKey];
      if (!Array.isArray(rows)) throw new Error(`Unexpected Loyverse response: ${collectionKey} is missing`);
      yield rows as T[];
      cursor = typeof page.cursor === "string" && page.cursor ? page.cursor : undefined;
    } while (cursor);
  }
}
