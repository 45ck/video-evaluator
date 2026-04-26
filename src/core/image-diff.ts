import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

interface PngImage {
  data: Uint8Array;
  width: number;
  height: number;
}

interface PngStatic {
  sync: { read: (buf: Buffer) => PngImage };
}

export type PixelmatchFn = (
  img1: Uint8Array,
  img2: Uint8Array,
  output: null | void | Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: { threshold: number },
) => number;

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as { PNG: PngStatic };

async function loadPixelmatch(): Promise<PixelmatchFn> {
  const mod = (await import("pixelmatch")) as unknown as { default: PixelmatchFn };
  return mod.default;
}

export interface PixelDiffResult {
  mismatchCount: number;
  mismatchPercent: number;
  totalPixels: number;
}

export async function diffPngBuffers(img1: Buffer, img2: Buffer, threshold = 0.1): Promise<PixelDiffResult> {
  const a = PNG.sync.read(img1);
  const b = PNG.sync.read(img2);
  if (a.width !== b.width || a.height !== b.height) {
    const totalPixels = Math.max(a.width * a.height, b.width * b.height);
    return { mismatchCount: totalPixels, mismatchPercent: 100, totalPixels };
  }
  const totalPixels = a.width * a.height;
  if (totalPixels === 0) {
    return { mismatchCount: 0, mismatchPercent: 0, totalPixels: 0 };
  }
  const pixelmatch = await loadPixelmatch();
  const mismatchCount = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold });
  return {
    mismatchCount,
    mismatchPercent: mismatchCount / totalPixels,
    totalPixels,
  };
}

export async function diffPngFiles(pathA: string, pathB: string, threshold = 0.1): Promise<PixelDiffResult> {
  const [bufA, bufB] = await Promise.all([readFile(pathA), readFile(pathB)]);
  return diffPngBuffers(bufA, bufB, threshold);
}
