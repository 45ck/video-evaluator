import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StoryboardUnderstandRequest } from "./schemas.js";

interface OcrFrame {
  index: number;
  timestampSeconds: number;
  lines: Array<{ text: string; confidence: number }>;
}

interface OcrManifest {
  storyboardDir: string;
  videoPath: string;
  frames: OcrFrame[];
  summary?: { uniqueLines?: string[] };
}

interface SummaryClaim {
  claim: string;
  evidence: Array<{
    frameIndex: number;
    line: string;
  }>;
}

export interface StoryboardSummaryManifest {
  schemaVersion: 1;
  createdAt: string;
  ocrPath: string;
  storyboardDir: string;
  videoPath: string;
  appNames: string[];
  views: string[];
  likelyCapabilities: SummaryClaim[];
  openQuestions: string[];
}

const CAPABILITY_PATTERNS: Array<{ claim: string; patterns: RegExp[] }> = [
  {
    claim: "Users can send students to ICT and start visit requests.",
    patterns: [/^send students$/i, /visit request/i, /students on their way to ict/i],
  },
  {
    claim: "The system tracks ICT queue and visit status counts.",
    patterns: [/incoming students/i, /^returned today$/i, /^departed$/i, /track visit progress/i],
  },
  {
    claim: "The product has authentication or sign-in flow.",
    patterns: [/sign in to access the system/i, /^username$/i, /^password$/i],
  },
  {
    claim: "Admins can configure visit settings and return mode.",
    patterns: [/visit settings/i, /return mode/i, /maximum time at ict/i, /save settings/i],
  },
  {
    claim: "The system exposes integrations with external services.",
    patterns: [/integrations/i, /microsoft teams/i, /freshservice/i],
  },
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function readOcrManifest(request: StoryboardUnderstandRequest): Promise<{ ocrPath: string; manifest: OcrManifest }> {
  const ocrPath = resolve(request.ocrPath ?? join(request.storyboardDir!, "storyboard.ocr.json"));
  const raw = await readFile(ocrPath, "utf8");
  return {
    ocrPath,
    manifest: JSON.parse(raw) as OcrManifest,
  };
}

function findAppNames(lines: string[]): string[] {
  const candidates = lines.filter(
    (line) => /tracker|portal|studio/i.test(line) && line.split(/\s+/).length <= 5,
  );
  return unique(candidates.map((line) => line.replace(/\s+/g, " ").trim())).slice(0, 5);
}

function findViews(lines: string[]): string[] {
  const views = lines.filter(
    (line) =>
      /teacher view|admin view|ict staff view|ict queue|administration/i.test(line) &&
      line.split(/\s+/).length <= 6,
  );
  return unique(views).slice(0, 12);
}

function buildClaims(frames: OcrFrame[]): SummaryClaim[] {
  const claims: SummaryClaim[] = [];
  for (const capability of CAPABILITY_PATTERNS) {
    const evidence = frames.flatMap((frame) =>
      frame.lines
        .filter((line) => capability.patterns.some((pattern) => pattern.test(line.text)))
        .map((line) => ({
          frameIndex: frame.index,
          line: line.text,
        })),
    );
    if (evidence.length > 0) {
      claims.push({
        claim: capability.claim,
        evidence: evidence.slice(0, 6),
      });
    }
  }
  return claims;
}

export async function understandStoryboard(input: StoryboardUnderstandRequest) {
  const { ocrPath, manifest } = await readOcrManifest(input);
  const lines = manifest.frames.flatMap((frame) => frame.lines.map((line) => line.text));
  const summary: StoryboardSummaryManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ocrPath,
    storyboardDir: manifest.storyboardDir,
    videoPath: manifest.videoPath,
    appNames: findAppNames(lines),
    views: findViews(lines),
    likelyCapabilities: buildClaims(manifest.frames),
    openQuestions: [
      "What exact user actions happened between these storyboard frames?",
      "Are all extracted role labels accurate or partially OCR-distorted?",
      "Which features appear in motion but not in the sampled frames?",
    ],
  };

  const outputPath = join(manifest.storyboardDir, "storyboard.summary.json");
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return {
    outputPath,
    manifest: summary,
  };
}
