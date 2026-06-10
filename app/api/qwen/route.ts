import {
  QWEN_ENDPOINT_ID,
  missingApiKeyResponse,
  readJsonBody,
  runpodFetch
} from "@/app/lib/runpod";

export const runtime = "nodejs";
export const maxDuration = 60;

type QwenRequest = {
  apiKey?: string;
  prompt?: string;
  imageBase64?: string;
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

  return runpodFetch(
    `https://api.runpod.ai/v2/${QWEN_ENDPOINT_ID}/runsync`,
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        input: {
          prompt: body.prompt.trim(),
          image_base64: body.imageBase64
        }
      })
    }
  );
}
