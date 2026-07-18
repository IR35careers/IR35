/**
 * HttpClient — polite, resilient JSON fetching for public ATS APIs.
 *
 * - Global rate limit: waits `minDelayMs` between ANY two requests through
 *   the same client instance (we're guests on these APIs).
 * - Retries: up to `maxRetries` attempts on network errors, timeouts, 429s
 *   and 5xx, with exponential backoff (base × 2^attempt).
 * - Timeout per attempt via AbortController.
 * - `fetchImpl` is injectable so tests can run without a network.
 */

export interface HttpClientOptions {
  minDelayMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpClient {
  private readonly minDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private lastRequestAt = 0;

  constructor(opts: HttpClientOptions = {}) {
    this.minDelayMs = opts.minDelayMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1500;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.userAgent = opts.userAgent ?? "IR35Careers-JobFetcher/1.0 (+https://ir35careers.com)";
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestAt + this.minDelayMs - now;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  /** GET a URL and parse JSON. Throws HttpError / Error after retries exhausted. */
  async getJson<T>(url: string, opts?: { headers?: Record<string, string> }): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(this.baseBackoffMs * 2 ** (attempt - 1));
      }
      await this.throttle();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "user-agent": this.userAgent,
            ...(opts?.headers ?? {}),
          },
        });

        if (res.ok) {
          return (await res.json()) as T;
        }

        // 4xx other than 429 will not improve on retry — fail fast.
        if (res.status !== 429 && res.status < 500) {
          throw new HttpError(res.status, url);
        }
        lastError = new HttpError(res.status, url);
      } catch (err) {
        if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
