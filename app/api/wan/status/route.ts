import {
  WAN_ENDPOINT_ID,
  getApiKeyFromHeader,
  missingApiKeyResponse,
  runpodFetch
} from "@/app/lib/runpod";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim() ?? "";
  const apiKey = getApiKeyFromHeader(request);

  if (!apiKey) {
    return missingApiKeyResponse();
  }

  if (!id) {
    return Response.json({ error: "Job id is required." }, { status: 400 });
  }

  return runpodFetch(
    `https://api.runpod.ai/v2/${WAN_ENDPOINT_ID}/status/${encodeURIComponent(id)}`,
    apiKey,
    { method: "GET" },
    15_000,
    3
  );
}
