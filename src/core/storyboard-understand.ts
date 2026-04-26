import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StoryboardUnderstandRequest } from "./schemas.js";

interface OcrFrame {
  index: number;
  timestampSeconds: number;
  lines: Array<{ text: string; confidence: number; region?: "top" | "middle" | "bottom" }>;
}

interface OcrManifest {
  storyboardDir: string;
  videoPath: string;
  frames: OcrFrame[];
  summary?: { uniqueLines?: string[] };
}

interface TransitionsManifest {
  transitions?: Array<{
    inferredTransition: string;
    fromFrameIndex: number;
    toFrameIndex: number;
    confidence: number;
    transitionKind?: "screen-change" | "state-change" | "scroll-change" | "dialog-change" | "uncertain";
  }>;
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
  likelyFlow: string[];
  likelyCapabilities: SummaryClaim[];
  openQuestions: string[];
}

const CAPABILITY_PATTERNS: Array<{ claim: string; patterns: RegExp[] }> = [
  {
    claim: "The product appears to offer chat-style IT help or guided support.",
    patterns: [/how can .+ help you today/i, /ask me anything/i, /tech helper/i, /message .+helper/i],
  },
  {
    claim: "The product provides step-by-step guided instructions.",
    patterns: [/^step \d+/i, /follow these simple steps/i, /getting started/i],
  },
  {
    claim: "The product can ground answers in referenced sources or guides.",
    patterns: [/\b\d+\s+sources\b/i, /guide$/i, /teacher guide/i],
  },
  {
    claim: "The system exposes browsable documentation or onboarding content.",
    patterns: [/documentation/i, /browse documentation/i, /new staff setup/i, /onboarding/i],
  },
  {
    claim: "The system includes authenticated or admin-only surfaces.",
    patterns: [/signed in as/i, /roles:/i, /superadmin/i, /log out/i],
  },
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

function normalizeMatchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDisplayLine(value: string): string {
  return value
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function tokenCount(value: string): number {
  return cleanDisplayLine(value).split(/\s+/).filter(Boolean).length;
}

function isLikelyUiNoise(value: string): boolean {
  const cleaned = cleanDisplayLine(value);
  if (!cleaned) return true;
  if (!/[A-Za-z]/.test(cleaned)) return true;
  if (cleaned.length <= 2) return true;
  if (/^[\W\d]+$/.test(cleaned)) return true;
  if (/^(q|x|v|o|adobe cc|404)$/i.test(cleaned)) return true;
  return false;
}

function extractKeywordPhrase(value: string, keywords: string[]): string | null {
  const cleaned = cleanDisplayLine(value);
  if (!cleaned) return null;
  const normalized = cleaned.replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  for (const keyword of keywords) {
    const match = normalized.match(
      new RegExp(`([A-Za-z][A-Za-z0-9]*(?:\\s+[A-Za-z][A-Za-z0-9]*){0,3}\\s+${keyword})`, "i"),
    );
    if (match?.[1]) return titleCase(match[1]);
    const keywordMatch = normalized.match(new RegExp(`\\b${keyword}\\b`, "i"));
    if (keywordMatch) return titleCase(keyword);
  }
  return null;
}

function collectRepeatedLabels(
  frames: OcrFrame[],
  options?: {
    minOccurrences?: number;
    requireTopRegion?: boolean;
    maxTokens?: number;
  },
) {
  const counts = new Map<
    string,
    {
      display: string;
      occurrences: number;
      topOccurrences: number;
      frames: Set<number>;
    }
  >();

  for (const frame of frames) {
    for (const line of frame.lines) {
      const display = cleanDisplayLine(line.text);
      const key = normalizeMatchKey(display);
      if (!key || isLikelyUiNoise(display)) continue;
      if ((options?.maxTokens ?? 6) < tokenCount(display)) continue;
      const existing =
        counts.get(key) ??
        {
          display,
          occurrences: 0,
          topOccurrences: 0,
          frames: new Set<number>(),
        };
      existing.display = existing.display.length >= display.length ? existing.display : display;
      existing.occurrences += 1;
      if (line.region === "top") existing.topOccurrences += 1;
      existing.frames.add(frame.index);
      counts.set(key, existing);
    }
  }

  return [...counts.values()]
    .filter((entry) => entry.frames.size >= (options?.minOccurrences ?? 2))
    .filter((entry) => !options?.requireTopRegion || entry.topOccurrences >= 1)
    .sort((a, b) => {
      if (b.topOccurrences !== a.topOccurrences) return b.topOccurrences - a.topOccurrences;
      if (b.frames.size !== a.frames.size) return b.frames.size - a.frames.size;
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return a.display.localeCompare(b.display);
    });
}

async function readOcrManifest(request: StoryboardUnderstandRequest): Promise<{ ocrPath: string; manifest: OcrManifest }> {
  const ocrPath = resolve(request.ocrPath ?? join(request.storyboardDir!, "storyboard.ocr.json"));
  const raw = await readFile(ocrPath, "utf8");
  return {
    ocrPath,
    manifest: JSON.parse(raw) as OcrManifest,
  };
}

function findAppNames(frames: OcrFrame[]): string[] {
  const appKeywords = ["helper", "documentation", "tracker", "portal", "studio", "assistant"];
  const repeated = collectRepeatedLabels(frames, {
    minOccurrences: 2,
    requireTopRegion: true,
    maxTokens: 5,
  });
  const repeatedCandidates = repeated
    .map((entry) => extractKeywordPhrase(entry.display, appKeywords) ?? entry.display)
    .filter((line) => /helper|documentation|tracker|portal|studio|assistant/i.test(line));
  const topLineCandidates = frames
    .flatMap((frame) => frame.lines)
    .filter((line) => line.region === "top")
    .map((line) => extractKeywordPhrase(line.text, appKeywords) ?? cleanDisplayLine(line.text))
    .filter((line) => !isLikelyUiNoise(line))
    .filter((line) => tokenCount(line) <= 5)
    .filter((line) => !/^(browse|guide|getting|new)\b/i.test(line))
    .filter((line) => /helper|documentation|tracker|portal|studio|assistant/i.test(line));

  return unique([...repeatedCandidates, ...topLineCandidates]).slice(0, 5);
}

function findViews(frames: OcrFrame[], appNames: string[]): string[] {
  const viewKeywords = [
    "guide",
    "settings",
    "queue",
    "administration",
    "overview",
    "onboarding",
    "documentation",
  ];
  const appNameKeys = new Set(appNames.map((name) => normalizeMatchKey(name)));
  const repeated = collectRepeatedLabels(frames, {
    minOccurrences: 2,
    requireTopRegion: false,
    maxTokens: 6,
  });
  const views = repeated
    .map((entry) => extractKeywordPhrase(entry.display, viewKeywords) ?? entry.display)
    .filter((line) => !appNameKeys.has(normalizeMatchKey(line)))
    .filter(
      (line) =>
        /teacher view|admin view|ict staff view|ict queue|administration|guide|getting started|overview|settings|documentation|queue|onboarding/i.test(
          line,
        ),
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

async function readTransitions(storyboardDir: string): Promise<TransitionsManifest | null> {
  try {
    const raw = await readFile(join(storyboardDir, "storyboard.transitions.json"), "utf8");
    return JSON.parse(raw) as TransitionsManifest;
  } catch {
    return null;
  }
}

function buildLikelyFlow(transitions: TransitionsManifest | null): string[] {
  if (!transitions?.transitions?.length) return [];
  return transitions.transitions
    .filter((transition) => transition.confidence >= 0.6)
    .map(
      (transition) =>
        `frame ${transition.fromFrameIndex} -> ${transition.toFrameIndex}: ${transition.transitionKind ?? "transition"} - ${transition.inferredTransition}`,
    );
}

export async function understandStoryboard(input: StoryboardUnderstandRequest) {
  const { ocrPath, manifest } = await readOcrManifest(input);
  const transitions = await readTransitions(manifest.storyboardDir);
  const appNames = findAppNames(manifest.frames);
  const views = findViews(manifest.frames, appNames);
  const summary: StoryboardSummaryManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ocrPath,
    storyboardDir: manifest.storyboardDir,
    videoPath: manifest.videoPath,
    appNames,
    views,
    likelyFlow: buildLikelyFlow(transitions),
    likelyCapabilities: buildClaims(manifest.frames),
    openQuestions: [
      "What exact user actions happened between these storyboard frames?",
      "Where does the video show local state changes versus full screen changes?",
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
