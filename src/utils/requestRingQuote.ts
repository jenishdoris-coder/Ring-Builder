export interface PublicRingQuote { total: number | null; currency: string; enabled: boolean; }
export interface QuoteRequest {
  endpoint: string; body: string; currency: string; signal: AbortSignal;
  fetcher?: typeof fetch; timeoutMs?: number; retryDelayMs?: number; method?: "GET" | "POST";
}

const pause = (duration: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException("Quote cancelled", "AbortError")); return; }
  const cancel = () => { clearTimeout(timer); reject(new DOMException("Quote cancelled", "AbortError")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, duration);
  signal.addEventListener("abort", cancel, { once: true });
});

/** An unavailable connection is different from a successful, unpriced quote.
 * Retry one transient failure, while cancelling obsolete selections promptly. */
export async function requestRingQuote({ endpoint, body, currency, signal, fetcher = fetch, timeoutMs = 8000, retryDelayMs = 250, method = "GET" }: QuoteRequest): Promise<PublicRingQuote> {
  // This endpoint only reads a public quote. GET also works when Safari omits
  // an Origin header on a local-network request; admin writes remain protected.
  const query = new URLSearchParams(JSON.parse(body) as Record<string, string>);
  const url = method === "GET" ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${query}` : endpoint;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) throw new DOMException("Quote cancelled", "AbortError");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, timeoutMs);
    let retryable = true;
    try {
      const response = await fetcher(url, { method, credentials: "same-origin", cache: "no-store", signal: controller.signal, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body } : {}) });
      if (!response.ok) {
        retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new Error("Quote request failed");
      }
      const data: unknown = await response.json();
      const quote = data as Partial<PublicRingQuote> | null;
      if (!quote || typeof quote !== "object" || (quote.total !== null && (typeof quote.total !== "number" || !Number.isFinite(quote.total) || quote.total < 0))
        || (quote.currency !== undefined && (typeof quote.currency !== "string" || !/^[A-Z]{3}$/.test(quote.currency)))) throw new Error("Invalid quote response");
      return { total: quote.total, currency: quote.currency || currency, enabled: quote.enabled !== false };
    } catch (error) {
      if (signal.aborted) throw new DOMException("Quote cancelled", "AbortError");
      if (!retryable || attempt === 1) throw error;
    } finally { clearTimeout(timeout); signal.removeEventListener("abort", cancel); }
    await pause(retryDelayMs, signal);
  }
  throw new Error("Quote unavailable");
}
