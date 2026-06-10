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

export async function runpodFetch(
  url: string,
  apiKey: string,
  init: RequestInit = {},
  timeoutMs = 55_000
) {
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
    const message =
      error instanceof DOMException && error.name === "AbortError"
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
