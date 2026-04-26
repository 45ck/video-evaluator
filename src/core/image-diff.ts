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

export interface NormalizedRegion {
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function cropPngRegion(image: PngImage, region: NormalizedRegion): PngImage {
  const x0 = Math.floor(clampUnit(region.x0 ?? 0) * image.width);
  const x1 = Math.ceil(clampUnit(region.x1 ?? 1) * image.width);
  const y0 = Math.floor(clampUnit(region.y0 ?? 0) * image.height);
  const y1 = Math.ceil(clampUnit(region.y1 ?? 1) * image.height);
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const data = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y0 + row) * image.width + x0) * 4;
    const sourceEnd = sourceStart + width * 4;
    const targetStart = row * width * 4;
    data.set(image.data.slice(sourceStart, sourceEnd), targetStart);
  }

  return { data, width, height };
}

export async function diffPngBuffers(img1: Buffer, img2: Buffer, threshold = 0.1): Promise<PixelDiffResult> {
  const a = PNG.sync.read(img1);
  const b = PNG.sync.read(img2);
  return diffDecodedPngImages(a, b, threshold);
}

async function diffDecodedPngImages(a: PngImage, b: PngImage, threshold = 0.1): Promise<PixelDiffResult> {
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

export async function diffPngRegionBuffers(
  img1: Buffer,
  img2: Buffer,
  region: NormalizedRegion,
  threshold = 0.1,
): Promise<PixelDiffResult> {
  const a = cropPngRegion(PNG.sync.read(img1), region);
  const b = cropPngRegion(PNG.sync.read(img2), region);
  return diffDecodedPngImages(a, b, threshold);
}

export async function diffPngRegionFiles(
  pathA: string,
  pathB: string,
  region: NormalizedRegion,
  threshold = 0.1,
): Promise<PixelDiffResult> {
  const [bufA, bufB] = await Promise.all([readFile(pathA), readFile(pathB)]);
  return diffPngRegionBuffers(bufA, bufB, region, threshold);
}
