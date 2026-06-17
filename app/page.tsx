"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import JSZip from "jszip";

type Mode = "image" | "batch" | "video" | "combo" | "comboLogo";
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

type QwenParams = {
  width: number;
  height: number;
};

type ReferenceImage = {
  id: string;
  base64: string;
  previewUrl: string;
  fileName: string;
};

type BatchGroup = {
  id: string;
  label: string;
  images: ReferenceImage[];
};

type BatchImageResult = {
  batchId: string;
  referenceFileNames: string[];
  references: ReferenceImage[];
  src: string;
};

type ComboPrompt = {
  id: string;
  text: string;
};

type ComboResult = {
  imageId: string;
  imageFileName: string;
  imagePreviewUrl: string;
  promptId: string;
  promptText: string;
  src: string;
};

type DragPayload = {
  imageId: string;
  source: "unassigned" | "batch";
  batchId?: string;
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

const initialQwenParams: QwenParams = {
  width: 1024,
  height: 1024
};

function stripDataUrlPrefix(value: string) {
  return value.replace(/^data:[^;]+;base64,/, "");
}

async function downloadAsZip(
  items: Array<{ filename: string; src: string }>,
  zipFileName: string
) {
  const zip = new JSZip();

  for (const item of items) {
    try {
      const response = await fetch(item.src);
      const blob = await response.blob();
      zip.file(item.filename, blob);
    } catch {
      // Skip individual files that fail to fetch
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

async function filesToReferenceImages(files: File[] | FileList) {
  const images: ReferenceImage[] = [];
  const skippedFileNames: string[] = [];

  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) {
      skippedFileNames.push(file.name);
      continue;
    }

    const dataUrl = await readFileAsDataUrl(file);
    images.push({
      id: crypto.randomUUID(),
      base64: stripDataUrlPrefix(dataUrl),
      previewUrl: dataUrl,
      fileName: file.name
    });
  }

  return { images, skippedFileNames };
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<Mode>("image");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [unassignedImages, setUnassignedImages] = useState<ReferenceImage[]>([]);
  const [batchGroups, setBatchGroups] = useState<BatchGroup[]>([]);
  const [nextBatchNumber, setNextBatchNumber] = useState(1);
  const [qwenParams, setQwenParams] = useState<QwenParams>(initialQwenParams);
  const [wanParams, setWanParams] = useState<WanParams>(initialWanParams);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batchResults, setBatchResults] = useState<BatchImageResult[]>([]);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeDropTarget, setActiveDropTarget] = useState<string | null>(null);
  const [comboLogoImage, setComboLogoImage] = useState<ReferenceImage | null>(null);
  const [comboImages, setComboImages] = useState<ReferenceImage[]>([]);
  const [comboPrompts, setComboPrompts] = useState<ComboPrompt[]>([]);
  const [comboResults, setComboResults] = useState<ComboResult[]>([]);
  const [comboProgress, setComboProgress] = useState({ done: 0, total: 0 });
  const isComboMode = mode === "combo" || mode === "comboLogo";

  const readyBatchGroups = useMemo(
    () => batchGroups.filter((group) => group.images.length > 0),
    [batchGroups]
  );
  const hasReferences =
    isComboMode
      ? comboImages.length > 0
      : mode === "batch"
        ? unassignedImages.length > 0 || batchGroups.length > 0
        : images.length > 0;

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

  const readyComboPrompts = useMemo(
    () => comboPrompts.filter((p) => p.text.trim().length > 0),
    [comboPrompts]
  );

  const comboCount = comboImages.length * readyComboPrompts.length;

  const comboHasContent =
    comboLogoImage !== null || comboImages.length > 0 || comboPrompts.length > 0;

  const actionLabel = useMemo(() => {
    if (isLoading) {
      if (isComboMode) return "Generating combinations...";
      if (mode === "batch") return "Generating images...";
      if (mode === "video") return "Generating video...";
      return "Generating image...";
    }

    if (isComboMode) {
      const promptCount = readyComboPrompts.length;
      const imgCount = comboImages.length;
      if (imgCount > 0 && promptCount > 0) {
        return `Generate ${imgCount}×${promptCount} (${comboCount} images)`;
      }
      return mode === "comboLogo" ? "Generate Combo Logo" : "Generate Combo";
    }

    if (mode === "batch" && readyBatchGroups.length > 1) {
      return `Generate ${readyBatchGroups.length} Batches`;
    }

    if (mode === "batch") return "Generate Batch";
    if (mode === "image") return "Generate Image";
    return "Generate Video";
  }, [comboCount, comboImages.length, isComboMode, isLoading, mode, readyBatchGroups.length, readyComboPrompts.length]);

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    setError("");
    setPreview(null);
    setBatchResults([]);

    if (!files || files.length === 0) return;

    const { images: newImages, skippedFileNames } = await filesToReferenceImages(files);
    showSkippedFileError(skippedFileNames);

    if (newImages.length === 0) return;

    if (mode === "video") {
      setImages(newImages.slice(0, 1));
      return;
    }

    if (mode === "batch") {
      setUnassignedImages((prev) => [...prev, ...newImages]);
      return;
    }

    setImages((prev) => [...prev, ...newImages]);
  }

  function showSkippedFileError(fileNames: string[]) {
    const skipped = fileNames.at(-1);
    if (skipped) {
      setError(`"${skipped}" is not an image file. Skipped.`);
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id));
    setBatchResults((prev) => prev.filter((r) => !r.references.some((img) => img.id === id)));
  }

  function removeUnassignedImage(id: string) {
    setUnassignedImages((prev) => prev.filter((img) => img.id !== id));
  }

  function downloadAllResults() {
    const items = batchResults.map((r) => {
      const name =
        r.referenceFileNames[0]?.replace(/\.[^.]+$/, "") ?? "batch";
      return { filename: `${name}_generated.png`, src: r.src };
    });
    downloadAsZip(items, "batch_results.zip");
  }

  function addBatchGroup() {
    const label = `Batch ${nextBatchNumber}`;
    setBatchGroups((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label,
        images: []
      }
    ]);
    setNextBatchNumber((current) => current + 1);
    setError("");
    setStatusText("");
  }

  function removeBatchGroup(id: string) {
    setBatchGroups((prev) => prev.filter((item) => item.id !== id));
    setBatchResults((prev) => prev.filter((r) => r.batchId !== id));
  }

  function clearAllImages() {
    setImages([]);
    setUnassignedImages([]);
    setBatchGroups([]);
    setNextBatchNumber(1);
    setBatchResults([]);
    setPreview(null);
  }

  function getDraggedImage(payload: DragPayload) {
    if (payload.source === "unassigned") {
      return unassignedImages.find((img) => img.id === payload.imageId) ?? null;
    }

    return (
      batchGroups
        .find((group) => group.id === payload.batchId)
        ?.images.find((img) => img.id === payload.imageId) ?? null
    );
  }

  function parseDragPayload(event: DragEvent<HTMLElement>) {
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return null;

    try {
      return JSON.parse(raw) as DragPayload;
    } catch {
      return null;
    }
  }

  function handleImageDragStart(
    event: DragEvent<HTMLElement>,
    image: ReferenceImage,
    source: DragPayload["source"],
    batchId?: string
  ) {
    const payload: DragPayload = { imageId: image.id, source, batchId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes("Files") ? "copy" : "move";
  }

  function handleDropTargetEnter(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    setActiveDropTarget(targetId);
  }

  function handleDropTargetLeave(event: DragEvent<HTMLElement>, targetId: string) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setActiveDropTarget((current) => (current === targetId ? null : current));
  }

  async function ingestDroppedImages(files: FileList) {
    setPreview(null);
    setBatchResults([]);

    const { images: newImages, skippedFileNames } = await filesToReferenceImages(files);
    showSkippedFileError(skippedFileNames);

    return newImages;
  }

  async function dropImageToPool(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setActiveDropTarget(null);

    if (event.dataTransfer.files.length > 0) {
      const newImages = await ingestDroppedImages(event.dataTransfer.files);
      if (newImages.length === 0) return;

      setUnassignedImages((prev) => [...prev, ...newImages]);
      setStatusText("");
      return;
    }

    const payload = parseDragPayload(event);
    if (!payload || payload.source === "unassigned") return;

    const image = getDraggedImage(payload);
    if (!image) return;

    setBatchGroups((prev) =>
      prev.map((group) =>
        group.id === payload.batchId
          ? { ...group, images: group.images.filter((img) => img.id !== payload.imageId) }
          : group
      )
    );
    setUnassignedImages((prev) => [...prev.filter((img) => img.id !== image.id), image]);
    setBatchResults((prev) => prev.filter((r) => !r.references.some((img) => img.id === image.id)));
    setError("");
    setStatusText("");
  }

  async function dropImageToBatch(event: DragEvent<HTMLElement>, targetBatchId: string) {
    event.preventDefault();
    setActiveDropTarget(null);

    const targetGroup = batchGroups.find((group) => group.id === targetBatchId);
    if (!targetGroup) return;

    if (event.dataTransfer.files.length > 0) {
      const newImages = await ingestDroppedImages(event.dataTransfer.files);
      if (newImages.length === 0) return;

      const availableSlots = 4 - targetGroup.images.length;
      if (availableSlots <= 0) {
        setError("Each batch can include up to 4 reference images.");
        setStatusText("");
        return;
      }

      const imagesToAdd = newImages.slice(0, availableSlots);
      setBatchGroups((prev) =>
        prev.map((group) =>
          group.id === targetBatchId
            ? { ...group, images: [...group.images, ...imagesToAdd] }
            : group
        )
      );

      if (newImages.length > availableSlots) {
        setError("Each batch can include up to 4 reference images.");
      }
      setStatusText("");
      return;
    }

    const payload = parseDragPayload(event);
    if (!payload) return;

    const image = getDraggedImage(payload);
    if (!image) return;

    const alreadyInTarget = targetGroup.images.some((img) => img.id === image.id);
    if (alreadyInTarget) return;

    if (targetGroup.images.length >= 4) {
      setError("Each batch can include up to 4 reference images.");
      setStatusText("");
      return;
    }

    if (payload.source === "unassigned") {
      setBatchGroups((prev) =>
        prev.map((group) =>
          group.id === targetBatchId ? { ...group, images: [...group.images, image] } : group
        )
      );
    } else {
      setBatchGroups((prev) =>
        prev.map((group) => {
          const withoutDragged = group.images.filter((img) => img.id !== image.id);

          if (group.id === targetBatchId) {
            return { ...group, images: [...withoutDragged, image] };
          }

          return { ...group, images: withoutDragged };
        })
      );
    }
    setBatchResults((prev) => prev.filter((r) => !r.references.some((img) => img.id === image.id)));
    setError("");
    setStatusText("");
  }

  function setWanNumber(key: keyof WanParams, value: string) {
    setWanParams((current) => ({
      ...current,
      [key]: Number(value)
    }));
  }

  function setQwenNumber(key: keyof QwenParams, value: string) {
    setQwenParams((current) => ({
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

    if (isComboMode) {
      return "";
    }

    if (!prompt.trim()) {
      return "Enter a prompt first.";
    }

    if (mode === "batch") {
      if (readyBatchGroups.length === 0) {
        return "Add images to at least one batch first.";
      }

      return "";
    }

    if (images.length === 0) {
      return "Upload at least one reference image first.";
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

  function addComboPrompt() {
    setComboPrompts((prev) => [...prev, { id: crypto.randomUUID(), text: "" }]);
    setError("");
    setStatusText("");
  }

  function removeComboPrompt(id: string) {
    setComboPrompts((prev) => prev.filter((p) => p.id !== id));
    setComboResults((prev) => prev.filter((r) => r.promptId !== id));
  }

  function updateComboPromptText(id: string, text: string) {
    setComboPrompts((prev) => prev.map((p) => (p.id === id ? { ...p, text } : p)));
  }

  async function handleComboImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    setError("");
    setComboResults([]);

    if (!files || files.length === 0) return;

    const { images: newImages, skippedFileNames } = await filesToReferenceImages(files);
    showSkippedFileError(skippedFileNames);

    if (newImages.length === 0) return;

    setComboImages((prev) => [...prev, ...newImages]);
  }

  async function handleComboLogoImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    setError("");
    setComboResults([]);
    setComboProgress({ done: 0, total: 0 });

    if (!files || files.length === 0) return;

    const { images: newImages, skippedFileNames } = await filesToReferenceImages(files);
    showSkippedFileError(skippedFileNames);

    const [newLogo] = newImages;
    if (!newLogo) return;

    setComboLogoImage(newLogo);
  }

  function removeComboLogoImage() {
    setComboLogoImage(null);
    setComboResults([]);
    setComboProgress({ done: 0, total: 0 });
  }

  function removeComboImage(id: string) {
    setComboImages((prev) => prev.filter((img) => img.id !== id));
    setComboResults((prev) => prev.filter((r) => r.imageId !== id));
  }

  function clearCombo() {
    setComboLogoImage(null);
    setComboImages([]);
    setComboPrompts([]);
    setComboResults([]);
    setComboProgress({ done: 0, total: 0 });
  }

  function downloadAllComboResults() {
    const items = comboResults.map((r) => {
      const imageName = r.imageFileName.replace(/\.[^.]+$/, "") ?? "combo";
      const promptSlug = r.promptText.slice(0, 30).replace(/\s+/g, "_");
      return { filename: `${imageName}_${promptSlug}.png`, src: r.src };
    });
    downloadAsZip(items, "combo_results.zip");
  }

  const comboIsComplete =
    comboProgress.total > 0 && comboProgress.done === comboProgress.total;

  function validateComboForm() {
    if (!apiKey.trim()) return "Enter your RunPod API key first.";
    if (mode === "comboLogo" && !comboLogoImage) return "Add a logo image first.";
    if (comboImages.length === 0) return "Add at least one reference image.";
    if (readyComboPrompts.length === 0) return "Add at least one prompt with text.";
    return "";
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
        setPreview(null);

        const body: Record<string, unknown> = {
          apiKey: apiKey.trim(),
          prompt,
          imageBase64: images[0].base64,
          ...qwenParams
        };
        for (let i = 1; i < images.length; i++) {
          body[`imageBase64${i + 1}`] = images[i].base64;
        }

        setStatusText("Sending image request to Qwen...");
        const response = await fetch("/api/qwen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
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

      if (mode === "batch") {
        setBatchResults([]);
        const results: BatchImageResult[] = [];
        let nextIndex = 0;
        let started = 0;
        const concurrency = 3;
        const groups = readyBatchGroups;

        async function processOne(group: BatchGroup) {
          const num = ++started;
          setStatusText(
            `[${num}/${groups.length}] Processing ${group.label} (${group.images.length} refs)...`
          );

          const body: Record<string, unknown> = {
            apiKey: apiKey.trim(),
            prompt,
            imageBase64: group.images[0].base64,
            ...qwenParams
          };

          for (let i = 1; i < group.images.length; i += 1) {
            body[`imageBase64${i + 1}`] = group.images[i].base64;
          }

          const res = await fetch("/api/qwen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          const data = await parseJsonResponse(res);
          const result = toPreview(data, "image");

          if (result) {
            results.push({
              batchId: group.id,
              referenceFileNames: group.images.map((img) => img.fileName),
              references: group.images,
              src: result.src
            });
            setBatchResults([...results]);
          }
        }

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, groups.length); i++) {
          workers.push(
            (async () => {
              while (true) {
                const idx = nextIndex++;
                if (idx >= groups.length) break;
                await processOne(groups[idx]);
              }
            })()
          );
        }
        await Promise.all(workers);

        const failed = groups.length - results.length;
        setStatusText(
          failed > 0
            ? `Batch complete: ${results.length} succeeded, ${failed} failed.`
            : `Batch complete: all ${results.length} batches succeeded.`
        );
        return;
      }

      if (isComboMode) {
        const validationError = validateComboForm();
        if (validationError) {
          setError(validationError);
          return;
        }

        setComboResults([]);
        const prompts = readyComboPrompts;
        const images = comboImages;
        const total = images.length * prompts.length;
        setComboProgress({ done: 0, total });

        const results: ComboResult[] = [];
        let nextIndex = 0;
        let started = 0;
        const concurrency = 3;

        async function processOne(imageIndex: number, promptIndex: number) {
          const image = images[imageIndex];
          const prompt = prompts[promptIndex];
          const num = ++started;

          setStatusText(
            `[${num}/${total}] ${image.fileName} × "${prompt.text.slice(0, 40)}${prompt.text.length > 40 ? "…" : ""}"...`
          );

          const body: Record<string, unknown> = {
            apiKey: apiKey.trim(),
            prompt: prompt.text.trim(),
            imageBase64: mode === "comboLogo" ? comboLogoImage?.base64 : image.base64,
            ...qwenParams
          };

          if (mode === "comboLogo") {
            body.imageBase642 = image.base64;
          }

          const result = await generateQwenImage(body, `[${num}/${total}] ${image.fileName}`);

          if (result) {
            const entry: ComboResult = {
              imageId: image.id,
              imageFileName: image.fileName,
              imagePreviewUrl: image.previewUrl,
              promptId: prompt.id,
              promptText: prompt.text.trim(),
              src: result.src
            };
            results.push(entry);
            setComboResults([...results]);
          }

          setComboProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        }

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, total); i++) {
          workers.push(
            (async () => {
              while (true) {
                const idx = nextIndex++;
                if (idx >= total) break;
                const imageIndex = Math.floor(idx / prompts.length);
                const promptIndex = idx % prompts.length;
                await processOne(imageIndex, promptIndex);
              }
            })()
          );
        }
        await Promise.all(workers);

        const failed = total - results.length;
        setStatusText(
          failed > 0
            ? `Combo complete: ${results.length} succeeded, ${failed} failed.`
            : `Combo complete: all ${results.length} combinations succeeded.`
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
              className={mode === "batch" ? "active" : ""}
              onClick={() => {
                setMode("batch");
                setStatusText("");
                setError("");
              }}
            >
              Batch
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
            <button
              type="button"
              className={mode === "combo" ? "active" : ""}
              onClick={() => {
                setMode("combo");
                setStatusText("");
                setError("");
              }}
            >
              Combo
            </button>
            <button
              type="button"
              className={mode === "comboLogo" ? "active" : ""}
              onClick={() => {
                setMode("comboLogo");
                setStatusText("");
                setError("");
              }}
            >
              Combo Logo
            </button>
          </div>

          {!isComboMode ? (
            <>
              <label className="field">
                <span>Reference Image{mode !== "video" ? "s" : ""}</span>
                <div className="file-input-row">
                  <input
                    type="file"
                    accept="image/*"
                    multiple={mode !== "video"}
                    onChange={handleImageChange}
                  />
                  {hasReferences ? (
                    <button type="button" className="clear-btn" onClick={clearAllImages}>
                      Clear all
                    </button>
                  ) : null}
                </div>
              </label>

              {images.length > 0 && mode !== "batch" ? (
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
            </>
          ) : null}

          {mode === "batch" ? (
            <div className="batch-workspace">
              <div className="batch-toolbar">
                <span>
                  {readyBatchGroups.length} ready batch
                  {readyBatchGroups.length === 1 ? "" : "es"}
                </span>
                <div className="batch-toolbar-actions">
                  <button
                    type="button"
                    className="download-all-btn"
                    onClick={downloadAllResults}
                    disabled={batchResults.length === 0}
                    title={
                      batchResults.length === 0
                        ? "Generate batch images first"
                        : "Download all generated images"
                    }
                  >
                    ↓ All ({batchResults.length})
                  </button>
                  <button type="button" className="add-batch-btn" onClick={addBatchGroup}>
                    +
                  </button>
                </div>
              </div>

              <div
                className={`batch-pool${activeDropTarget === "pool" ? " is-drop-active" : ""}`}
                onDragEnter={(event) => handleDropTargetEnter(event, "pool")}
                onDragLeave={(event) => handleDropTargetLeave(event, "pool")}
                onDragOver={handleDragOver}
                onDrop={dropImageToPool}
                aria-label="Unassigned reference images"
              >
                <div className="batch-pool-header">
                  <strong>Unassigned</strong>
                  <span>
                    {unassignedImages.length} image
                    {unassignedImages.length === 1 ? "" : "s"}
                  </span>
                </div>
                {unassignedImages.length > 0 ? (
                  <div className="reference-grid">
                    {unassignedImages.map((img) => (
                      <div
                        key={img.id}
                        className="reference-thumb draggable-reference"
                        draggable
                        onDragStart={(event) => handleImageDragStart(event, img, "unassigned")}
                      >
                        <img src={img.previewUrl} alt={img.fileName} />
                        <button
                          type="button"
                          className="remove-btn"
                          onClick={() => removeUnassignedImage(img.id)}
                        >
                          ×
                        </button>
                        <span>{img.fileName}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="batch-empty-state">Drop images here</p>
                )}
              </div>

              <div className="batch-reference-queue" aria-label="Batch reference queue">
                {batchGroups.map((group) => (
                  <div
                    key={group.id}
                    className={`batch-reference-card${
                      activeDropTarget === group.id ? " is-drop-active" : ""
                    }`}
                    onDragEnter={(event) => handleDropTargetEnter(event, group.id)}
                    onDragLeave={(event) => handleDropTargetLeave(event, group.id)}
                    onDragOver={handleDragOver}
                    onDrop={(event) => dropImageToBatch(event, group.id)}
                  >
                    <div className="batch-reference-thumbs">
                      {group.images.length > 0
                        ? group.images.map((img) => (
                            <img
                              key={img.id}
                              src={img.previewUrl}
                              alt={img.fileName}
                              draggable
                              onDragStart={(event) =>
                                handleImageDragStart(event, img, "batch", group.id)
                              }
                            />
                          ))
                        : Array.from({ length: 4 }, (_, index) => (
                            <span key={index} className="batch-thumb-placeholder" />
                          ))}
                    </div>
                    <div className="batch-reference-meta">
                      <strong>{group.label}</strong>
                      <span title={group.images.map((img) => img.fileName).join(", ")}>
                        {group.images.length > 0
                          ? `${group.images.length} reference${
                              group.images.length > 1 ? "s" : ""
                            }: ${group.images.map((img) => img.fileName).join(", ")}`
                          : "Drop up to 4 references"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="batch-remove-btn"
                      onClick={() => removeBatchGroup(group.id)}
                      aria-label={`Remove ${group.label}`}
                    >
                      −
                    </button>
                  </div>
                ))}
                {batchGroups.length === 0 ? (
                  <p className="batch-empty-state">Create a batch, then drag images into it.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {isComboMode ? (
            <>
              {mode === "comboLogo" ? (
                <>
                  <label className="field">
                    <span>Logo Image</span>
                    <div className="file-input-row">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleComboLogoImageChange}
                      />
                      {comboLogoImage ? (
                        <button
                          type="button"
                          className="clear-btn"
                          onClick={removeComboLogoImage}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </label>

                  {comboLogoImage ? (
                    <div className="reference-grid">
                      <div className="reference-thumb">
                        <img src={comboLogoImage.previewUrl} alt={comboLogoImage.fileName} />
                        <button
                          type="button"
                          className="remove-btn"
                          onClick={removeComboLogoImage}
                        >
                          ×
                        </button>
                        <span>{comboLogoImage.fileName}</span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              <label className="field">
                <span>Reference Images</span>
                <div className="file-input-row">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleComboImageChange}
                  />
                  {comboHasContent ? (
                    <button type="button" className="clear-btn" onClick={clearCombo}>
                      Clear all
                    </button>
                  ) : null}
                </div>
              </label>

              {comboImages.length > 0 ? (
                <div className="reference-grid">
                  {comboImages.map((img) => (
                    <div key={img.id} className="reference-thumb">
                      <img src={img.previewUrl} alt={img.fileName} />
                      <button
                        type="button"
                        className="remove-btn"
                        onClick={() => removeComboImage(img.id)}
                      >
                        ×
                      </button>
                      <span>{img.fileName}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="combo-prompts-section">
                <div className="combo-prompts-header">
                  <span>Prompts</span>
                  <button type="button" className="combo-add-prompt-btn" onClick={addComboPrompt}>
                    + Add prompt
                  </button>
                </div>

                {comboPrompts.length > 0 ? (
                  <div className="combo-prompts">
                    {comboPrompts.map((p, i) => (
                      <div key={p.id} className="combo-prompt-card">
                        <span className="combo-prompt-index">{i + 1}</span>
                        <textarea
                          value={p.text}
                          onChange={(event) => updateComboPromptText(p.id, event.target.value)}
                          placeholder={`Prompt ${i + 1} — describe the image you want to generate...`}
                          rows={3}
                        />
                        <button
                          type="button"
                          className="combo-prompt-remove"
                          onClick={() => removeComboPrompt(p.id)}
                          title="Remove prompt"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="combo-empty-state">Add at least one prompt to get started.</p>
                )}
              </div>

              {comboCount > 0 && !comboIsComplete ? (
                <p className="combo-summary">
                  {mode === "comboLogo" ? "1 logo + " : ""}
                  {comboImages.length} image{comboImages.length > 1 ? "s" : ""} ×{" "}
                  {readyComboPrompts.length} prompt{readyComboPrompts.length > 1 ? "s" : ""} ={" "}
                  {comboCount} combination{comboCount > 1 ? "s" : ""}
                </p>
              ) : null}

              {comboIsComplete ? (
                <div className="combo-summary combo-summary-complete">
                  <span>
                    {comboResults.length}/{comboCount} combination
                    {comboCount > 1 ? "s" : ""} complete
                  </span>
                  <button
                    type="button"
                    className="combo-download-all-btn"
                    onClick={downloadAllComboResults}
                    disabled={comboResults.length === 0}
                  >
                    ↓ Download All ({comboResults.length})
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {!isComboMode ? (
            <label className="field">
              <span>{mode === "video" ? "Video Prompt" : "Image Prompt"}</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  mode === "video"
                    ? "Describe the motion, camera, and visual style..."
                    : "Describe the image you want Qwen to generate..."
                }
                rows={mode === "video" ? 7 : 6}
              />
            </label>
          ) : null}

          {mode !== "video" ? (
            <div className="param-grid qwen-param-grid">
              <label className="field">
                <span>Width</span>
                <input
                  type="number"
                  min="128"
                  step="8"
                  value={qwenParams.width}
                  onChange={(event) => setQwenNumber("width", event.target.value)}
                />
              </label>
              <label className="field">
                <span>Height</span>
                <input
                  type="number"
                  min="128"
                  step="8"
                  value={qwenParams.height}
                  onChange={(event) => setQwenNumber("height", event.target.value)}
                />
              </label>
            </div>
          ) : null}

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
            <h2>
              {isComboMode && comboResults.length > 0
                ? mode === "comboLogo"
                  ? "Combo Logo Results"
                  : "Combo Results"
                : batchResults.length > 0
                  ? "Batch Results"
                  : "Latest Preview"}
            </h2>
            <span>
              {isComboMode && comboResults.length > 0
                ? `${comboResults.length}/${comboProgress.total} combination${comboProgress.total > 1 ? "s" : ""}`
                : batchResults.length > 0
                  ? `${batchResults.length} batch${batchResults.length > 1 ? "es" : ""}`
                  : isComboMode && comboProgress.total > 0
                    ? `${comboProgress.done}/${comboProgress.total}`
                    : preview
                      ? preview.kind
                      : "empty"}
            </span>
          </div>

          {isComboMode && (comboResults.length > 0 || comboProgress.total > 0) ? (
            <div className="combo-matrix-wrapper">
              <div
                className="combo-matrix"
                style={
                  {
                    "--combo-cols": readyComboPrompts.length || comboPrompts.length
                  } as React.CSSProperties
                }
              >
                <div className="combo-matrix-corner" />
                {comboPrompts.map((p, i) => (
                  <div key={p.id} className="combo-matrix-col-header" title={p.text}>
                    {p.text || `Prompt ${i + 1}`}
                  </div>
                ))}
                {comboImages.map((img) => (
                  <div key={img.id} className="combo-matrix-row">
                    <div className="combo-matrix-row-header">
                      <img src={img.previewUrl} alt={img.fileName} />
                      <span title={img.fileName}>{img.fileName}</span>
                    </div>
                    {comboPrompts.map((prompt) => {
                      const result = comboResults.find(
                        (r) => r.imageId === img.id && r.promptId === prompt.id
                      );
                      return (
                        <div key={prompt.id} className="combo-matrix-cell">
                          {result ? (
                            <div className="combo-matrix-result">
                              <img src={result.src} alt={`${img.fileName} × ${prompt.text}`} />
                              <a
                                href={result.src}
                                download={`${img.fileName.replace(/\.[^.]+$/, "")}_${prompt.text.slice(0, 30).replace(/\s+/g, "_")}.png`}
                                className="combo-matrix-download"
                                title="Download"
                              >
                                ↓
                              </a>
                            </div>
                          ) : (
                            <div className="combo-matrix-pending">
                              {comboProgress.done > 0 &&
                              comboResults.findIndex(
                                (r) => r.imageId === img.id && r.promptId === prompt.id
                              ) === -1
                                ? "—"
                                : ""}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!(isComboMode && (comboResults.length > 0 || comboProgress.total > 0)) &&
          batchResults.length > 0 ? (
            <div className="results-grid">
              {batchResults.map((r) => {
                const referenceLabel = r.referenceFileNames.join(", ");
                const downloadName =
                  r.referenceFileNames[0]?.replace(/\.[^.]+$/, "") ?? "batch";

                return (
                  <div key={r.batchId} className="result-card">
                    <div className="result-card-images">
                      <div className="result-card-ref-wrap">
                        <div className="result-card-ref-grid">
                          {r.references.map((ref) => (
                            <img
                              key={ref.id}
                              className="result-card-ref"
                              src={ref.previewUrl}
                              alt={ref.fileName}
                            />
                          ))}
                        </div>
                        <span className="result-card-label">Input</span>
                      </div>
                      <div className="result-card-gen-wrap">
                        <img
                          className="result-card-gen"
                          src={r.src}
                          alt={`Generated from ${referenceLabel}`}
                        />
                        <span className="result-card-label">Output</span>
                      </div>
                    </div>
                    <div className="result-card-footer">
                      <span title={referenceLabel}>{referenceLabel}</span>
                      <a href={r.src} download={`${downloadName}_generated.png`}>
                        ↓
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {!(isComboMode && (comboResults.length > 0 || comboProgress.total > 0)) &&
          batchResults.length === 0 ? (
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
          ) : null}
        </section>
      </section>
    </main>
  );
}
