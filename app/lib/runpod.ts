import { NextResponse } from "next/server";

export const QWEN_ENDPOINT_ID = "2qy0f4rw9djn7u";
export const WAN_ENDPOINT_ID = "i83jbbmfx8zd9j";

export type RunPodError = {
  error?: string;
  detail?: unknown;
};

export function missingApiKeyResponse() {
  return NextResponse.json(
    { error: "RunPod API key is required." },
    { status: 400 }
  );
}

export function getApiKeyFromHeader(request: Request) {
  return request.headers.get("x-runpod-api-key")?.trim() ?? "";
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Exponential backoff with jitter — waits before the next retry attempt. */
async function backoff(attempt: number) {
  const delay = 1000 * Math.pow(2, attempt) + Math.random() * 1000;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** Whether the HTTP status code represents a transient failure worth retrying. */
function isRetryableStatus(status: number) {
  return status >= 500 || status === 429;
}

/**
 * Call the RunPod API with automatic retry for transient failures.
 *
 * Retryable failures: network errors, timeouts, 5xx, and 429 rate limits.
 * Non-retryable (returned immediately): 4xx client errors.
 *
 * @param url - RunPod API endpoint URL
 * @param apiKey - Bearer token for Authorization header
 * @param init - Additional fetch options (method, body, etc.)
 * @param timeoutMs - Per-attempt timeout in milliseconds (default 55s)
 * @param maxRetries - Max retries on transient failure (default 2, making 3 total attempts)
 */
export async function runpodFetch(
  url: string,
  apiKey: string,
  init: RequestInit = {},
  timeoutMs = 55_000,
  maxRetries = 2
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(init.headers ?? {})
        }
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : {};

      if (!response.ok) {
        // Non-retryable (4xx) — return immediately
        if (!isRetryableStatus(response.status)) {
          return NextResponse.json(
            {
              error: "RunPod request failed.",
              detail: data
            } satisfies RunPodError,
            { status: response.status }
          );
        }

        // Retryable (5xx, 429) — exhaust attempts before returning error
        if (attempt < maxRetries) {
          await backoff(attempt);
          continue;
        }

        return NextResponse.json(
          {
            error: "RunPod request failed.",
            detail: data
          } satisfies RunPodError,
          { status: response.status }
        );
      }

      return NextResponse.json(data);
    } catch (error) {
      const isTimeout =
        error instanceof DOMException && error.name === "AbortError";

      if (attempt < maxRetries) {
        await backoff(attempt);
        continue;
      }

      const message = isTimeout
        ? "RunPod request timed out."
        : "Unable to reach RunPod.";

      return NextResponse.json(
        {
          error: message,
          detail: error instanceof Error ? error.message : String(error)
        } satisfies RunPodError,
        { status: 504 }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  // Unreachable — the loop always returns on its last iteration
  throw new Error("runpodFetch: unexpected exit from retry loop");
}
