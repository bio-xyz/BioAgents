import logger from "./logger";

export interface FetchRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = `${error.name} ${error.message}`.toLowerCase();
  const code = ((error as NodeJS.ErrnoException).code || "").toLowerCase();
  return /econnre|enotfound|etimedout|socket|network|fetch failed|abort|unable to connect|connectionrefused/i.test(
    msg + " " + code,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Default: 10 retries with ~5 min total window (11 attempts)
// Delays: 4s, 8s, 16s, 32s, 40s×6 = 300s total
export async function fetchWithRetry(
  input: string | URL | Request,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<{ response: Response; attempts: number }> {
  const maxRetries = options?.maxRetries ?? 10;
  const initialDelayMs = options?.initialDelayMs ?? 4000;
  const maxDelayMs = options?.maxDelayMs ?? 40000;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const wait = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      logger.debug({ attempt, wait }, "fetch_retry_waiting");
      await delay(wait);
    }

    try {
      const response = await fetch(
        input instanceof Request && attempt > 0 ? input.clone() : input,
        init,
      );

      if (!RETRYABLE_STATUS_CODES.has(response.status)) {
        return { response, attempts: attempt + 1 };
      }

      lastError = new Error(`HTTP ${response.status}`);
      options?.onRetry?.(attempt + 1, lastError);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryable(lastError)) throw lastError;

      options?.onRetry?.(attempt + 1, lastError);
    }
  }

  throw new Error(
    `All ${maxRetries + 1} attempts failed: ${lastError?.message}`,
  );
}
