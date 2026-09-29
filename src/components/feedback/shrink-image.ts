"use client";

/**
 * Getting a member's screenshots ready to send (Batch 18), in the browser.
 *
 * Vercel refuses a request over 4.5 MB, and phones take big photos, so each
 * image is re-drawn as a JPEG before it is sent: photos always (which also
 * leaves their location data behind), a PNG only when it is big, so a phone
 * screenshot stays sharp. If the whole report is still over its budget the
 * biggest image is drawn again, smaller, until it fits; if it cannot, the
 * member is asked to remove one. The rules are src/lib/feedback/rules.ts
 * (needsReencode, nextShrink, SHRINK_PASSES); this is only the drawing.
 */
import { IMAGE } from "@/lib/feedback/config";
import { SHRINK_PASSES, needsReencode, nextShrink, scaledSize } from "@/lib/feedback/rules";

export interface PreparedImage {
  /** The file the member picked: kept so a harder pass starts from the original. */
  source: File;
  blob: Blob;
  type: "image/jpeg" | "image/png" | "image/webp";
  /** The pass it was drawn at; -1 when it is sent as picked. */
  pass: number;
  previewUrl: string;
}

export type PrepareError = "not_an_image" | "too_big" | "unreadable";

const ACCEPTED = new Set<string>(IMAGE.types);

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      /* fall back to an <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function toJpeg(img: Decoded, passIndex: number): Promise<Blob | null> {
  const pass = SHRINK_PASSES[passIndex];
  const { width, height } = scaledSize(img.width, img.height, pass.longEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  // JPEG has no transparency: a transparent PNG would otherwise turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img.source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", pass.quality));
}

async function draw(file: File, passIndex: number): Promise<Blob | null> {
  const img = await decode(file);
  if (!img) return null;
  try {
    return await toJpeg(img, passIndex);
  } finally {
    img.close();
  }
}

/**
 * One picked image, ready to send, or why it cannot be. `maxBytes` is the
 * setting for the picked file (feedback_screenshot_max_mb). A type the form
 * does not accept (HEIC, say) is converted when this browser can read it.
 */
export async function prepareImage(file: File, maxBytes: number): Promise<{ ok: true; image: PreparedImage } | { ok: false; error: PrepareError }> {
  if (file.size > maxBytes) return { ok: false, error: "too_big" };
  const declared = ACCEPTED.has(file.type) ? file.type : null;
  const img = await decode(file);
  if (!img) return { ok: false, error: declared ? "unreadable" : "not_an_image" };
  try {
    if (declared === "image/png" && !needsReencode(declared, file.size, img.width, img.height)) {
      return { ok: true, image: { source: file, blob: file, type: "image/png", pass: -1, previewUrl: URL.createObjectURL(file) } };
    }
    const blob = await toJpeg(img, 0);
    if (!blob) return { ok: false, error: "unreadable" };
    return { ok: true, image: { source: file, blob, type: "image/jpeg", pass: 0, previewUrl: URL.createObjectURL(blob) } };
  } finally {
    img.close();
  }
}

/**
 * Draws the biggest images again, harder each time, until the report is
 * under IMAGE.requestBudgetBytes. Returns the images to send, or null when
 * even the smallest passes do not fit (the member must remove one).
 */
export async function fitToBudget(images: PreparedImage[], textBytes: number): Promise<PreparedImage[] | null> {
  const out = [...images];
  for (let guard = 0; guard < 12; guard += 1) {
    const step = nextShrink(out.map((i) => ({ bytes: i.blob.size, pass: i.pass })), textBytes);
    if (step.action === "ok") return out;
    if (step.action === "too_big") return null;
    const current = out[step.index];
    const pass = step.pass;
    const blob = await draw(current.source, pass);
    if (!blob) return null;
    out[step.index] = { ...current, blob, type: "image/jpeg", pass };
  }
  return null;
}
