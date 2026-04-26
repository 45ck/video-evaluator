import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function resolveTesseractCacheDir(): string {
  return join(process.cwd(), ".cache", "video-evaluator", "tesseract");
}

function resolveLocalEngCandidates(): string[] {
  return [
    process.env.VIDEO_EVALUATOR_TESSDATA_PATH,
    join(process.cwd(), "eng.traineddata"),
    join(PACKAGE_ROOT, "eng.traineddata"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function ensureLocalEngTrainedData(cacheDir: string): Promise<void> {
  const localEng = resolveLocalEngCandidates().find((candidate) => existsSync(candidate));
  if (!localEng) return;

  const dest = join(cacheDir, "eng.traineddata");
  if (existsSync(dest)) return;
  try {
    await copyFile(localEng, dest);
  } catch {
    // Best effort only.
  }
}

export async function createTesseractWorkerEng(): Promise<{ worker: any; cacheDir: string }> {
  const Tesseract = await import("tesseract.js");
  const cacheDir = resolveTesseractCacheDir();
  await mkdir(cacheDir, { recursive: true });
  await ensureLocalEngTrainedData(cacheDir);

  const hasLocalEng = existsSync(join(cacheDir, "eng.traineddata"));
  const worker = await Tesseract.createWorker("eng", undefined, {
    cachePath: cacheDir,
    ...(hasLocalEng ? { langPath: cacheDir } : null),
  } as any);

  await worker.setParameters({ tessedit_pageseg_mode: "6" as any });
  return { worker, cacheDir };
}
