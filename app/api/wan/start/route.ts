import {
  WAN_ENDPOINT_ID,
  missingApiKeyResponse,
  readJsonBody,
  runpodFetch
} from "@/app/lib/runpod";

export const runtime = "nodejs";
export const maxDuration = 20;

type WanStartRequest = {
  apiKey?: string;
  prompt?: string;
  negativePrompt?: string;
  imageBase64?: string;
  width?: number;
  height?: number;
  length?: number;
  steps?: number;
  seed?: number;
  cfg?: number;
};

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function POST(request: Request) {
  const body = await readJsonBody<WanStartRequest>(request);
  const apiKey = body?.apiKey?.trim() ?? "";

  if (!apiKey) {
    return missingApiKeyResponse();
  }

  if (!body?.prompt?.trim()) {
    return Response.json({ error: "Prompt is required." }, { status: 400 });
  }

  if (!body.imageBase64?.trim()) {
    return Response.json(
      { error: "Reference image is required." },
      { status: 400 }
    );
  }

  return runpodFetch(
    `https://api.runpod.ai/v2/${WAN_ENDPOINT_ID}/run`,
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        input: {
          prompt: body.prompt.trim(),
          negative_prompt: body.negativePrompt?.trim() ?? "",
          image_base64: body.imageBase64,
          width: numberOrDefault(body.width, 480),
          height: numberOrDefault(body.height, 832),
          length: numberOrDefault(body.length, 49),
          steps: numberOrDefault(body.steps, 30),
          seed: numberOrDefault(body.seed, 42),
          cfg: numberOrDefault(body.cfg, 5)
        }
      })
    },
    15_000
  );
}
