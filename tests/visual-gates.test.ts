import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  VISUAL_DIFF_SCHEMA_VERSION,
  VisualDiffArtifactSchema,
} from "../src/contracts/index.js";
import {
  compareGoldenFrame,
  reviewDemoVisualFrames,
} from "../src/visual/golden-frame.js";

interface PngImage {
  data: Uint8Array;
}

interface PngConstructor {
  new (input: { width: number; height: number }): PngImage;
  sync: { write: (png: PngImage) => Buffer };
}

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as { PNG: PngConstructor };

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-visual-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writePng(
  path: string,
  width: number,
  height: number,
  color: [number, number, number, number],
  patch?: { x: number; y: number; color: [number, number, number, number] },
): Promise<void> {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = color[0];
    png.data[index + 1] = color[1];
    png.data[index + 2] = color[2];
    png.data[index + 3] = color[3];
  }
  if (patch) {
    const offset = (patch.y * width + patch.x) * 4;
    png.data[offset] = patch.color[0];
    png.data[offset + 1] = patch.color[1];
    png.data[offset + 2] = patch.color[2];
    png.data[offset + 3] = patch.color[3];
  }
  await writeFile(path, PNG.sync.write(png));
}

test("golden-frame compare emits passing visual diff report", async () => {
  await withTempDir(async (dir) => {
    const baseline = join(dir, "baseline.png");
    const current = join(dir, "current.png");
    const outputPath = join(dir, "report.json");
    await writePng(baseline, 4, 4, [255, 0, 0, 255]);
    await writePng(current, 4, 4, [255, 0, 0, 255]);

    const result = await compareGoldenFrame({
      baselineFramePath: baseline,
      currentFramePath: current,
      outputPath,
    });
    const persisted = VisualDiffArtifactSchema.parse(
      JSON.parse(await readFile(outputPath, "utf8")),
    );

    assert.equal(result.report.schemaVersion, VISUAL_DIFF_SCHEMA_VERSION);
    assert.equal(result.report.overallStatus, "pass");
    assert.equal(result.report.frames[0]?.mismatchPercent, 0);
    assert.equal(result.reportPath, outputPath);
    assert.equal(persisted.overallStatus, "pass");
  });
});

test("golden-frame compare applies warn and fail thresholds", async () => {
  await withTempDir(async (dir) => {
    const baseline = join(dir, "baseline.png");
    const current = join(dir, "current.png");
    await writePng(baseline, 10, 10, [0, 0, 0, 255]);
    await writePng(current, 10, 10, [0, 0, 0, 255], {
      x: 0,
      y: 0,
      color: [255, 255, 255, 255],
    });

    const warn = await compareGoldenFrame({
      baselineFramePath: baseline,
      currentFramePath: current,
      maxMismatchPercent: 0,
      warnMismatchPercent: 0.02,
    });
    const fail = await compareGoldenFrame({
      baselineFramePath: baseline,
      currentFramePath: current,
      maxMismatchPercent: 0,
      warnMismatchPercent: 0.005,
    });

    assert.equal(warn.report.overallStatus, "warn");
    assert.equal(warn.report.frames[0]?.metadata?.status, "warn");
    assert.equal(fail.report.overallStatus, "fail");
    assert.equal(fail.report.frames[0]?.mismatchPixelCount, 1);
  });
});

test("golden-frame compare reports missing baseline without throwing", async () => {
  await withTempDir(async (dir) => {
    const baseline = join(dir, "missing.png");
    const current = join(dir, "current.png");
    await writePng(current, 4, 4, [0, 128, 255, 255]);

    const result = await compareGoldenFrame({
      baselineFramePath: baseline,
      currentFramePath: current,
    });

    assert.equal(result.report.overallStatus, "skip");
    assert.equal(result.report.frames.length, 0);
    assert.equal(result.report.diagnostics[0]?.code, "missing-baseline-frame");
  });
});

test("golden-frame compare fails dimension mismatch with explicit diagnostic", async () => {
  await withTempDir(async (dir) => {
    const baseline = join(dir, "baseline.png");
    const current = join(dir, "current.png");
    await writePng(baseline, 4, 4, [0, 0, 0, 255]);
    await writePng(current, 5, 4, [0, 0, 0, 255]);

    const result = await compareGoldenFrame({
      baselineFramePath: baseline,
      currentFramePath: current,
    });

    assert.equal(result.report.overallStatus, "fail");
    assert.equal(result.report.frames[0]?.mismatchPercent, 1);
    assert.equal(result.report.diagnostics[0]?.code, "dimension-mismatch");
  });
});

test("golden-frame update mode creates or replaces the baseline", async () => {
  await withTempDir(async (dir) => {
    const baseline = join(dir, "baselines", "home.png");
    const current = join(dir, "current.png");
    await writePng(current, 4, 4, [12, 34, 56, 255]);

    const result = await compareGoldenFrame({
      baselineFramePath: baseline,
      currentFramePath: current,
      mode: "update",
    });

    assert.equal(result.report.overallStatus, "pass");
    assert.equal(result.report.frames[0]?.mismatchPercent, 0);
    assert.equal(result.report.diagnostics[0]?.code, "baseline-updated");
    assert.deepEqual(await readFile(baseline), await readFile(current));
  });
});

test("demo visual review compares current directory against baseline directory", async () => {
  await withTempDir(async (dir) => {
    const baselineDir = join(dir, "baseline");
    const currentDir = join(dir, "current");
    await mkdir(baselineDir);
    await mkdir(currentDir);
    await writePng(join(baselineDir, "001.png"), 3, 3, [255, 255, 255, 255]);
    await writePng(join(currentDir, "001.png"), 3, 3, [255, 255, 255, 255]);
    await writePng(join(currentDir, "002.png"), 3, 3, [255, 255, 255, 255]);

    const result = await reviewDemoVisualFrames({
      baselineDir,
      currentDir,
      outputDir: dir,
    });

    assert.equal(result.reportPath, join(dir, "demo-visual-review.diff.json"));
    assert.equal(result.report.overallStatus, "skip");
    assert.equal(result.report.frames.length, 1);
    assert.equal(result.report.summary?.comparedFrameCount, 1);
    assert.equal(result.report.diagnostics[0]?.code, "missing-baseline-frame");
  });
});
