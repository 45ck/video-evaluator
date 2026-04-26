import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

function resolveTesseractCacheDir(): string {
  return join(process.cwd(), ".cache", "video-evaluator", "tesseract");
}

async function ensureLocalEngTrainedData(cacheDir: string): Promise<void> {
  const localEng = join(process.cwd(), "eng.traineddata");
  if (!existsSync(localEng)) return;

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
