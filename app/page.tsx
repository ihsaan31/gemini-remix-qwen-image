"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "image" | "video";
type MediaKind = "image" | "video";

type Preview = {
  kind: MediaKind;
  src: string;
};

type WanParams = {
  negativePrompt: string;
  width: number;
  height: number;
  length: number;
  steps: number;
  seed: number;
  cfg: number;
};

type ReferenceImage = {
  id: string;
  base64: string;
  previewUrl: string;
  fileName: string;
};

type BatchImageResult = {
  referenceId: string;
  referenceFileName: string;
  src: string;
};

const defaultNegativePrompt =
  "blurry, low quality, distorted face, deformed hands, extra fingers, bad anatomy, warped body, flickering, jitter, unstable face, duplicate person, melted face, cartoon, anime, overexposed, underexposed, low resolution";

const defaultVideoPrompt =
  "A realistic cinematic vertical video of the same person from the reference image. Natural movement, realistic lighting, high detail, stable face, consistent identity.";

const initialWanParams: WanParams = {
  negativePrompt: defaultNegativePrompt,
  width: 480,
  height: 832,
  length: 49,
  steps: 30,
  seed: 42,
  cfg: 5
};

function stripDataUrlPrefix(value: string) {
  return value.replace(/^data:[^;]+;base64,/, "");
}

function isVideoUrl(value: string) {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(value);
}

function looksLikeBase64(value: string) {
  return /^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 120;
}

function toPreview(value: unknown, preferredKind: MediaKind): Preview | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.startsWith("data:")) {
      return {
        kind: trimmed.startsWith("data:video") ? "video" : "image",
        src: trimmed
      };
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return { kind: isVideoUrl(trimmed) ? "video" : preferredKind, src: trimmed };
    }

    if (looksLikeBase64(trimmed)) {
      const mime = preferredKind === "video" ? "video/mp4" : "image/png";
      return { kind: preferredKind, src: `data:${mime};base64,${trimmed}` };
    }

    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = toPreview(item, preferredKind);
      if (result) {
        return result;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = [
      record.video_url,
      record.video,
      record.mp4,
      record.url,
      record.image_url,
      record.image,
      record.image_base64,
      record.output,
      record.outputs,
      record.result,
      record.results
    ];

    for (const candidate of candidates) {
      const result = toPreview(candidate, preferredKind);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<Mode>("image");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [wanParams, setWanParams] = useState<WanParams>(initialWanParams);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batchResults, setBatchResults] = useState<BatchImageResult[]>([]);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setApiKey(sessionStorage.getItem("runpodApiKey") ?? "");
  }, []);

  useEffect(() => {
    if (apiKey) {
      sessionStorage.setItem("runpodApiKey", apiKey);
    } else {
      sessionStorage.removeItem("runpodApiKey");
    }
  }, [apiKey]);

  const actionLabel = useMemo(() => {
    if (isLoading) {
      return mode === "image" ? "Generating images..." : "Generating video...";
    }

    if (mode === "image" && images.length > 1) {
      return `Generate ${images.length} Images`;
    }

    return mode === "image" ? "Generate Image" : "Generate Video";
  }, [isLoading, mode, images.length]);

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    setError("");
    setPreview(null);
    setBatchResults([]);

    if (!files || files.length === 0) return;

    const newImages: ReferenceImage[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        setError(`"${file.name}" is not an image file. Skipped.`);
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      newImages.push({
        id: crypto.randomUUID(),
        base64: stripDataUrlPrefix(dataUrl),
        previewUrl: dataUrl,
        fileName: file.name
      });
    }

    if (newImages.length === 0) return;

    if (mode === "video") {
      setImages(newImages.slice(0, 1));
    } else {
      setImages((prev) => [...prev, ...newImages]);
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id));
    if (batchResults.length > 0) {
      setBatchResults((prev) => prev.filter((r) => r.referenceId !== id));
    }
  }

  function clearAllImages() {
    setImages([]);
    setBatchResults([]);
    setPreview(null);
  }

  function setWanNumber(key: keyof WanParams, value: string) {
    setWanParams((current) => ({
      ...current,
      [key]: Number(value)
    }));
  }

  async function parseJsonResponse(response: Response) {
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error ?? "Request failed.");
    }

    return data;
  }

  function validateForm() {
    if (!apiKey.trim()) {
      return "Enter your RunPod API key first.";
    }

    if (images.length === 0) {
      return "Upload at least one reference image first.";
    }

    if (!prompt.trim()) {
      return "Enter a prompt first.";
    }

    return "";
  }

  async function pollWanJob(jobId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const response = await fetch(`/api/wan/status?id=${encodeURIComponent(jobId)}`, {
        headers: {
          "x-runpod-api-key": apiKey.trim()
        }
      });
      const data = await parseJsonResponse(response);
      const status = String(data.status ?? "UNKNOWN");

      setStatusText(`Video job ${status.toLowerCase().replaceAll("_", " ")}.`);

      if (status === "COMPLETED") {
        const result = toPreview(data, "video");

        if (!result) {
          throw new Error("Video completed, but no video URL or base64 output was found.");
        }

        setPreview(result);
        return;
      }

      if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(status)) {
        throw new Error(data.error ?? `Video job ${status.toLowerCase().replaceAll("_", " ")}.`);
      }
    }

    throw new Error("Video job is still running after the polling timeout.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatusText("");

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setPreview(null);

    try {
      if (mode === "image") {
        if (images.length === 1) {
          setStatusText("Sending image request to Qwen...");
          const response = await fetch("/api/qwen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey: apiKey.trim(),
              prompt,
              imageBase64: images[0].base64
            })
          });
          const data = await parseJsonResponse(response);
          const result = toPreview(data, "image");

          if (!result) {
            throw new Error("No image URL or base64 output was found in the Qwen response.");
          }

          setPreview(result);
          setStatusText("Image complete.");
          return;
        }

        setBatchResults([]);
        const results: BatchImageResult[] = [];
        let nextIndex = 0;
        let completed = 0;
        const concurrency = 3;

        async function processOne(img: ReferenceImage) {
          const num = ++completed;
          setStatusText(`[${num}/${images.length}] Processing ${img.fileName}...`);

          const res = await fetch("/api/qwen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey: apiKey.trim(),
              prompt,
              imageBase64: img.base64
            })
          });
          const data = await parseJsonResponse(res);
          const result = toPreview(data, "image");

          if (result) {
            results.push({
              referenceId: img.id,
              referenceFileName: img.fileName,
              src: result.src
            });
            setBatchResults([...results]);
          }
        }

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, images.length); i++) {
          workers.push(
            (async () => {
              while (true) {
                const idx = nextIndex++;
                if (idx >= images.length) break;
                await processOne(images[idx]);
              }
            })()
          );
        }
        await Promise.all(workers);

        const failed = images.length - results.length;
        setStatusText(
          failed > 0
            ? `Batch complete: ${results.length} succeeded, ${failed} failed.`
            : `Batch complete: all ${results.length} images succeeded.`
        );
        return;
      }

      setStatusText("Starting Wan video job...");
      const response = await fetch("/api/wan/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          prompt,
          imageBase64: images[0]?.base64 ?? "",
          ...wanParams
        })
      });
      const data = await parseJsonResponse(response);
      const jobId = String(data.id ?? "");

      if (!jobId) {
        throw new Error("Wan did not return a job id.");
      }

      setStatusText(`Video job queued: ${jobId}`);
      await pollWanJob(jobId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
      setStatusText("");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Qwen + Wan Generator</h1>
          <p>Generate images or videos from reference images.</p>
        </div>
        <label className="api-key">
          <span>RunPod API Key</span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="rpa_..."
            type="password"
            autoComplete="off"
          />
        </label>
      </header>

      <section className="workspace">
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <div className="mode-tabs" aria-label="Generation mode">
            <button
              type="button"
              className={mode === "image" ? "active" : ""}
              onClick={() => {
                setMode("image");
                setStatusText("");
                setError("");
              }}
            >
              Image
            </button>
            <button
              type="button"
              className={mode === "video" ? "active" : ""}
              onClick={() => {
                setMode("video");
                setPrompt((current) => current || defaultVideoPrompt);
                setStatusText("");
                setError("");
              }}
            >
              Video
            </button>
          </div>

          <label className="field">
            <span>Reference Image{mode === "image" ? "s" : ""}</span>
            <div className="file-input-row">
              <input
                type="file"
                accept="image/*"
                multiple={mode === "image"}
                onChange={handleImageChange}
              />
              {images.length > 0 ? (
                <button type="button" className="clear-btn" onClick={clearAllImages}>
                  Clear all
                </button>
              ) : null}
            </div>
          </label>

          {images.length > 0 ? (
            <div className="reference-grid">
              {images.map((img) => (
                <div key={img.id} className="reference-thumb">
                  <img src={img.previewUrl} alt={img.fileName} />
                  <button
                    type="button"
                    className="remove-btn"
                    onClick={() => removeImage(img.id)}
                  >
                    ×
                  </button>
                  <span>{img.fileName}</span>
                </div>
              ))}
            </div>
          ) : null}

          <label className="field">
            <span>{mode === "image" ? "Image Prompt" : "Video Prompt"}</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                mode === "image"
                  ? "Describe the image you want Qwen to generate..."
                  : "Describe the motion, camera, and visual style..."
              }
              rows={mode === "image" ? 6 : 7}
            />
          </label>

          {mode === "video" ? (
            <div className="advanced">
              <label className="field wide">
                <span>Negative Prompt</span>
                <textarea
                  value={wanParams.negativePrompt}
                  onChange={(event) =>
                    setWanParams((current) => ({
                      ...current,
                      negativePrompt: event.target.value
                    }))
                  }
                  rows={4}
                />
              </label>

              <div className="param-grid">
                <label className="field">
                  <span>Width</span>
                  <input
                    type="number"
                    min="128"
                    step="8"
                    value={wanParams.width}
                    onChange={(event) => setWanNumber("width", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Height</span>
                  <input
                    type="number"
                    min="128"
                    step="8"
                    value={wanParams.height}
                    onChange={(event) => setWanNumber("height", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Length</span>
                  <input
                    type="number"
                    min="1"
                    value={wanParams.length}
                    onChange={(event) => setWanNumber("length", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Steps</span>
                  <input
                    type="number"
                    min="1"
                    value={wanParams.steps}
                    onChange={(event) => setWanNumber("steps", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Seed</span>
                  <input
                    type="number"
                    value={wanParams.seed}
                    onChange={(event) => setWanNumber("seed", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>CFG</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={wanParams.cfg}
                    onChange={(event) => setWanNumber("cfg", event.target.value)}
                  />
                </label>
              </div>
            </div>
          ) : null}

          <button className="submit-button" type="submit" disabled={isLoading}>
            {actionLabel}
          </button>

          {error ? <p className="message error">{error}</p> : null}
          {statusText ? <p className="message status">{statusText}</p> : null}
        </form>

        <section className="panel preview-panel" aria-label="Generation preview">
          <div className="preview-header">
            <h2>{batchResults.length > 0 ? "Batch Results" : "Latest Preview"}</h2>
            <span>
              {batchResults.length > 0
                ? `${batchResults.length} image${batchResults.length > 1 ? "s" : ""}`
                : preview
                  ? preview.kind
                  : "empty"}
            </span>
          </div>

          {batchResults.length > 0 ? (
            <div className="results-grid">
              {batchResults.map((r) => (
                <div key={r.referenceId} className="result-card">
                  <img src={r.src} alt={`Generated from ${r.referenceFileName}`} />
                  <div className="result-card-footer">
                    <span title={r.referenceFileName}>{r.referenceFileName}</span>
                    <a
                      href={r.src}
                      download={`${r.referenceFileName.replace(/\.[^.]+$/, "")}_generated.png`}
                    >
                      ↓
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="preview-frame">
              {preview?.kind === "image" ? (
                <img src={preview.src} alt="Generated result" />
              ) : null}
              {preview?.kind === "video" ? (
                <video src={preview.src} controls playsInline />
              ) : null}
              {!preview && !isLoading ? (
                <div className="empty-preview">
                  <span>No output yet</span>
                </div>
              ) : null}
              {!preview && isLoading ? (
                <div className="empty-preview">
                  <span>Waiting for output...</span>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
