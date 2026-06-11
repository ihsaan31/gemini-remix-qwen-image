import {
  QWEN_ENDPOINT_ID,
  missingApiKeyResponse,
  readJsonBody,
  runpodFetch
} from "@/app/lib/runpod";

export const runtime = "nodejs";
export const maxDuration = 300;

type QwenRequest = {
  apiKey?: string;
  prompt?: string;
  imageBase64?: string;
  imageBase642?: string;
  imageBase643?: string;
  imageBase644?: string;
  seed?: number;
  width?: number;
  height?: number;
};

export async function POST(request: Request) {
  const body = await readJsonBody<QwenRequest>(request);
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

  const input: Record<string, unknown> = {
    prompt: body.prompt.trim(),
    image_base64: body.imageBase64
  };

  if (body.imageBase642) input.image_base64_2 = body.imageBase642;
  if (body.imageBase643) input.image_base64_3 = body.imageBase643;
  if (body.imageBase644) input.image_base64_4 = body.imageBase644;
  if (body.seed !== undefined) input.seed = body.seed;
  if (body.width !== undefined) input.width = body.width;
  if (body.height !== undefined) input.height = body.height;

  return runpodFetch(
    `https://api.runpod.ai/v2/${QWEN_ENDPOINT_ID}/runsync`,
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({ input })
    },
    290_000,
    1
  );
}
