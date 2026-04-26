import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StoryboardUnderstandRequest } from "./schemas.js";

interface OcrFrame {
  index: number;
  timestampSeconds: number;
  samplingReason?: "uniform" | "change-peak" | "coverage-fill";
  nearestChangeDistanceSeconds?: number;
  lines: Array<{ text: string; confidence: number; region?: "top" | "middle" | "bottom" }>;
}

interface OcrManifest {
  storyboardDir: string;
  videoPath: string;
  samplingMode?: "uniform" | "hybrid";
  changeThreshold?: number;
  detectedChangeCount?: number;
  frames: OcrFrame[];
  summary?: { uniqueLines?: string[] };
}

interface StoryboardManifestFallback {
  samplingMode?: "uniform" | "hybrid";
  detectedChangeCount?: number;
  frames?: Array<{
    index: number;
    samplingReason?: "uniform" | "change-peak" | "coverage-fill";
    nearestChangeDistanceSeconds?: number;
  }>;
}

interface TransitionsManifest {
  transitions?: Array<{
    inferredTransition: string;
    fromFrameIndex: number;
    toFrameIndex: number;
    fromTimestampSeconds?: number;
    toTimestampSeconds?: number;
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

interface TextDominanceSummary {
  likelyNarrationDominated: boolean;
  narrationLikeLineShare: number;
  narrationLikeFrameShare: number;
  dominantRegion?: "top" | "middle" | "bottom" | "mixed";
  notes: string[];
}

export interface StoryboardSummaryManifest {
  schemaVersion: 1;
  createdAt: string;
  ocrPath: string;
  storyboardDir: string;
  videoPath: string;
  appNames: string[];
  views: string[];
  sampling: {
    mode?: "uniform" | "hybrid";
    detectedChangeCount?: number;
    frameReasonCounts: Record<"uniform" | "change-peak" | "coverage-fill", number>;
    averageNearestChangeDistanceSeconds?: number;
    notes: string[];
  };
  interactionSegments: Array<{
    startFrameIndex: number;
    endFrameIndex: number;
    startTimestampSeconds: number;
    endTimestampSeconds: number;
    transitionKinds: Array<"screen-change" | "state-change" | "scroll-change" | "dialog-change" | "uncertain">;
    summary: string;
    evidence: string[];
  }>;
  likelyFlow: string[];
  likelyCapabilities: SummaryClaim[];
  openQuestions: string[];
  textDominance: TextDominanceSummary;
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

const RESTORE_UPPERCASE_TOKENS = new Map([
  ["mc", "MC"],
  ["ict", "ICT"],
  ["seqta", "SEQTA"],
  ["it", "IT"],
  ["ui", "UI"],
  ["pdf", "PDF"],
  ["3cx", "3CX"],
]);

const GENERIC_VIEW_LABELS = new Set([
  "Guide",
  "Overview",
  "Getting Started",
  "Introduction",
  "Onboarding",
  "Settings",
  "Documentation",
  "Administration",
]);

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
    .map((token) => {
      const normalized = token.toLowerCase();
      const restored = RESTORE_UPPERCASE_TOKENS.get(normalized);
      if (restored) return restored;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");
}

const APP_NAME_KEYWORDS = ["helper", "documentation", "tracker", "portal", "studio", "assistant"];
const APP_NAME_STOPWORDS = new Set(["to", "the", "a", "an", "my", "your", "via", "option"]);
const APP_LABEL_CONTEXT_STOPWORDS = /\b(option|direct|download|accessing|access|click|open|page|website|under|on this page)\b/i;

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

function canonicalizeAppLikeLabel(value: string): string {
  const cleaned = cleanDisplayLine(value);
  const normalized = cleaned.replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return cleaned;
  const tokens = normalized.split(" ");
  const keywordIndex = tokens.findIndex((token) => APP_NAME_KEYWORDS.includes(token.toLowerCase()));
  if (keywordIndex === -1) return cleaned;
  const sliceStart = Math.max(0, keywordIndex - 2);
  const canonical = tokens
    .slice(sliceStart, keywordIndex + 1)
    .filter((token) => !APP_NAME_STOPWORDS.has(token.toLowerCase()))
    .filter((token) => token.length >= 2 || APP_NAME_KEYWORDS.includes(token.toLowerCase()))
    .join(" ");
  return canonical ? titleCase(canonical) : titleCase(normalized);
}

function canonicalizeViewLikeLabel(value: string): string | null {
  const cleaned = cleanDisplayLine(value);
  if (!cleaned) return null;
  const normalized = cleaned.replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const normalizeProductTokens = (phrase: string) =>
    phrase
      .replace(/\bseqta tea[a-z]*\b/gi, "SEQTA Teach")
      .replace(/\beducation perf[a-z]*\b/gi, "Education Perfect");
  const trimTrailingNoise = (phrase: string) =>
    phrase
      .replace(/\b(on this page|what youll learn|top bar features|student summ views|student views|help centre)\b.*$/i, "")
      .trim();
  const buildVerbPhrase = (prefix: string, remainder: string, maxTailTokens: number) => {
    const tailTokens = normalizeProductTokens(trimTrailingNoise(remainder))
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, maxTailTokens);
    if (tailTokens.length === 0) return null;
    return `${prefix} ${titleCase(tailTokens.join(" "))}`.trim();
  };
  const specificPatterns = [
    { pattern: /logging in to ([a-z0-9 ]{3,})/i, build: (value: string) => buildVerbPhrase("Logging In To", value, 3) },
    { pattern: /how to log in to ([a-z0-9 ]{3,})/i, build: (value: string) => buildVerbPhrase("Logging In To", value, 3) },
    { pattern: /accessing ([a-z0-9 ]{3,})/i, build: (value: string) => buildVerbPhrase("Accessing", value, 4) },
    { pattern: /(what you(?:ll|'ll) learn)/i, build: (value: string) => titleCase(value) },
    { pattern: /(getting started)/i, build: (value: string) => titleCase(value) },
    { pattern: /(teacher view)/i, build: (value: string) => titleCase(value) },
    { pattern: /(admin(?:istration)? view)/i, build: (value: string) => titleCase(value) },
    { pattern: /(ict staff view)/i, build: (value: string) => titleCase(value) },
    { pattern: /(ict queue)/i, build: (value: string) => titleCase(value) },
    { pattern: /(administration)/i, build: (value: string) => titleCase(value) },
    { pattern: /(settings)/i, build: (value: string) => titleCase(value) },
    { pattern: /(overview)/i, build: (value: string) => titleCase(value) },
    { pattern: /(onboarding)/i, build: (value: string) => titleCase(value) },
  ];
  for (const { pattern, build } of specificPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return build(match[1]);
  }
  return null;
}

function dedupeApproximateLabels(values: string[]): string[] {
  const kept: string[] = [];
  const keys = new Set<string>();
  for (const value of values) {
    const key = normalizeMatchKey(
      value
        .replace(/\bseqta tea[a-z]*\b/gi, "seqta teach")
        .replace(/\beducation perf[a-z]*\b/gi, "education perfect"),
    );
    if (!key) continue;
    if (keys.has(key)) continue;
    keys.add(key);
    kept.push(value);
  }
  return kept;
}

function isLikelyAppLabelSource(value: string): boolean {
  const cleaned = cleanDisplayLine(value);
  if (!cleaned) return false;
  if (APP_LABEL_CONTEXT_STOPWORDS.test(cleaned)) return false;
  return APP_NAME_KEYWORDS.some((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(cleaned));
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
  const candidateCounts = new Map<string, { frames: Set<number>; topHits: number }>();
  for (const frame of frames) {
    for (const line of frame.lines) {
      if (line.region !== "top") continue;
      if (!isLikelyAppLabelSource(line.text)) continue;
      const candidate = canonicalizeAppLikeLabel(extractKeywordPhrase(line.text, APP_NAME_KEYWORDS) ?? cleanDisplayLine(line.text));
      if (isLikelyUiNoise(candidate) || tokenCount(candidate) > 5) continue;
      const existing = candidateCounts.get(candidate) ?? { frames: new Set<number>(), topHits: 0 };
      existing.frames.add(frame.index);
      existing.topHits += 1;
      candidateCounts.set(candidate, existing);
    }
  }

  const repeated = collectRepeatedLabels(frames, {
    minOccurrences: 2,
    requireTopRegion: true,
    maxTokens: 5,
  });
  const repeatedCandidates = repeated
    .filter((entry) => isLikelyAppLabelSource(entry.display))
    .map((entry) => canonicalizeAppLikeLabel(extractKeywordPhrase(entry.display, APP_NAME_KEYWORDS) ?? entry.display))
    .filter((line) => /helper|documentation|tracker|portal|studio|assistant/i.test(line));
  const rankedTopLineCandidates = [...candidateCounts.entries()]
    .filter(([, info]) => info.frames.size >= 2)
    .sort((left, right) => {
      if (right[1].frames.size !== left[1].frames.size) return right[1].frames.size - left[1].frames.size;
      if (right[1].topHits !== left[1].topHits) return right[1].topHits - left[1].topHits;
      return left[0].localeCompare(right[0]);
    })
    .map(([candidate]) => candidate);

  return unique([...repeatedCandidates, ...rankedTopLineCandidates]).slice(0, 5);
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
  const repeatedViews = repeated
    .map((entry) => canonicalizeViewLikeLabel(extractKeywordPhrase(entry.display, viewKeywords) ?? entry.display) ?? titleCase(entry.display))
    .filter((line) => !appNameKeys.has(normalizeMatchKey(line)))
    .filter(
      (line) =>
        /teacher view|admin view|ict staff view|ict queue|administration|guide|getting started|overview|settings|documentation|queue|onboarding/i.test(
          line,
        ),
    );

  const headlineViews = frames
    .flatMap((frame) =>
      frame.lines
        .filter((line) => line.region !== "bottom")
        .filter((line) => line.confidence >= 70)
        .map((line) => canonicalizeViewLikeLabel(line.text))
        .filter((line): line is string => Boolean(line)),
    )
    .filter((line) => !appNameKeys.has(normalizeMatchKey(line)));

  const combined = dedupeApproximateLabels([...headlineViews, ...repeatedViews]).slice(0, 12);
  const hasSpecificView = combined.some((line) => !GENERIC_VIEW_LABELS.has(line));
  return hasSpecificView ? combined.filter((line) => !GENERIC_VIEW_LABELS.has(line)).slice(0, 12) : combined;
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

const NARRATION_LIKE_HINTS = [
  /\b(here's how|here is how|great question|you're all set|if you have any questions|just follow|follow these simple steps)\b/i,
  /\b(step\s+\d+|step one|step two|step three|step four|step five)\b/i,
  /\b(sign in|log in|connect|access|navigate|click|select|open|press|enter|type|choose|tap|help|ask)\b/i,
];

function isNarrationLikeLine(value: string): boolean {
  const cleaned = cleanDisplayLine(value);
  if (!cleaned) return false;
  if (cleaned.length < 12) return false;
  if (NARRATION_LIKE_HINTS.some((pattern) => pattern.test(cleaned))) return true;
  if (/[.?!]/.test(cleaned)) return true;
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return wordCount >= 10 && /[a-z]/i.test(cleaned) && /\b(i|you|we|how|what|when|where|why|can|will|should)\b/i.test(cleaned);
}

function buildTextDominanceSummary(frames: OcrFrame[]): TextDominanceSummary {
  let narrationLikeLineCount = 0;
  let narrationLikeFrameCount = 0;
  let totalLineCount = 0;
  const regionCounts = {
    top: 0,
    middle: 0,
    bottom: 0,
  } satisfies Record<"top" | "middle" | "bottom", number>;

  for (const frame of frames) {
    let frameNarrationCount = 0;
    for (const line of frame.lines) {
      totalLineCount += 1;
      if (line.region) regionCounts[line.region] += 1;
      if (!isNarrationLikeLine(line.text)) continue;
      narrationLikeLineCount += 1;
      frameNarrationCount += 1;
    }
    if (frameNarrationCount >= 2 || frameNarrationCount / Math.max(1, frame.lines.length) >= 0.5) {
      narrationLikeFrameCount += 1;
    }
  }

  const narrationLikeLineShare = narrationLikeLineCount / Math.max(1, totalLineCount);
  const narrationLikeFrameShare = narrationLikeFrameCount / Math.max(1, frames.length);
  const dominantRegionEntries = Object.entries(regionCounts).sort((left, right) => right[1] - left[1]);
  const [dominantRegion, dominantCount] = dominantRegionEntries[0] ?? ["mixed", 0];
  const dominantRegionValue =
    dominantCount > 0 && dominantCount / Math.max(1, narrationLikeLineCount) >= 0.5
      ? (dominantRegion as "top" | "middle" | "bottom")
      : "mixed";
  const likelyNarrationDominated = narrationLikeLineShare >= 0.4 && narrationLikeFrameShare >= 0.5;
  const notes: string[] = [];

  if (likelyNarrationDominated) {
    notes.push(
      `Narration-like OCR accounts for ${Math.round(narrationLikeLineShare * 100)}% of lines across ${narrationLikeFrameCount}/${frames.length} frames.`,
    );
  } else if (narrationLikeLineShare >= 0.2) {
    notes.push(`Some OCR lines read like narration or subtitles (${Math.round(narrationLikeLineShare * 100)}% of lines).`);
  } else {
    notes.push("OCR is mostly short UI labels rather than sentence-like narration.");
  }

  if (dominantRegionValue !== "mixed") {
    notes.push(`Narration-like text is concentrated in the ${dominantRegionValue} region.`);
  }

  return {
    likelyNarrationDominated,
    narrationLikeLineShare: Number(narrationLikeLineShare.toFixed(3)),
    narrationLikeFrameShare: Number(narrationLikeFrameShare.toFixed(3)),
    dominantRegion: dominantRegionValue,
    notes,
  };
}

function buildSamplingSummary(
  manifest: OcrManifest,
  fallback: StoryboardManifestFallback | null,
): StoryboardSummaryManifest["sampling"] {
  const frameReasonCounts = {
    uniform: 0,
    "change-peak": 0,
    "coverage-fill": 0,
  } satisfies Record<"uniform" | "change-peak" | "coverage-fill", number>;
  const changeDistances: number[] = [];
  let annotatedFrameCount = 0;
  const fallbackFrames = new Map((fallback?.frames ?? []).map((frame) => [frame.index, frame]));
  for (const frame of manifest.frames) {
    const fallbackFrame = fallbackFrames.get(frame.index);
    const reason = frame.samplingReason ?? fallbackFrame?.samplingReason ?? "uniform";
    if (frame.samplingReason || fallbackFrame?.samplingReason) {
      annotatedFrameCount += 1;
    }
    frameReasonCounts[reason] += 1;
    const nearestDistance = frame.nearestChangeDistanceSeconds ?? fallbackFrame?.nearestChangeDistanceSeconds;
    if (typeof nearestDistance === "number" && Number.isFinite(nearestDistance)) {
      changeDistances.push(nearestDistance);
    }
  }

  const averageNearestChangeDistanceSeconds =
    changeDistances.length > 0
      ? Number(
          (
            changeDistances.reduce((sum, value) => sum + value, 0) /
            Math.max(1, changeDistances.length)
          ).toFixed(3),
        )
      : undefined;
  const notes: string[] = [];
  const effectiveSamplingMode = manifest.samplingMode ?? fallback?.samplingMode;
  const effectiveDetectedChangeCount = manifest.detectedChangeCount ?? fallback?.detectedChangeCount;

  if (effectiveSamplingMode === "hybrid") {
    if (annotatedFrameCount > 0) {
      notes.push(
        `Hybrid sampling used ${frameReasonCounts["change-peak"]} change-biased frames and ${frameReasonCounts["coverage-fill"]} coverage-fill frames.`,
      );
    } else {
      notes.push("Hybrid sampling metadata exists, but this artifact does not include frame-level sampling annotations.");
    }
    if (typeof effectiveDetectedChangeCount === "number") {
      notes.push(`Detected ${effectiveDetectedChangeCount} candidate change points before frame selection.`);
    }
    if (typeof averageNearestChangeDistanceSeconds === "number") {
      notes.push(
        `Selected frames were on average ${averageNearestChangeDistanceSeconds}s from the nearest detected change point.`,
      );
    }
  } else {
    notes.push("Uniform sampling was used, so local UI changes between frames may be missed.");
  }

  return {
    mode: effectiveSamplingMode,
    detectedChangeCount: effectiveDetectedChangeCount,
    frameReasonCounts,
    averageNearestChangeDistanceSeconds,
    notes,
  };
}

async function readTransitions(storyboardDir: string): Promise<TransitionsManifest | null> {
  try {
    const raw = await readFile(join(storyboardDir, "storyboard.transitions.json"), "utf8");
    return JSON.parse(raw) as TransitionsManifest;
  } catch {
    return null;
  }
}

async function readStoryboardSamplingFallback(storyboardDir: string): Promise<StoryboardManifestFallback | null> {
  try {
    const raw = await readFile(join(storyboardDir, "storyboard.manifest.json"), "utf8");
    return JSON.parse(raw) as StoryboardManifestFallback;
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

function isSegmentWorthyTransition(transition: NonNullable<TransitionsManifest["transitions"]>[number]) {
  if (transition.confidence < 0.6) return false;
  if (transition.transitionKind && transition.transitionKind !== "screen-change" && transition.transitionKind !== "uncertain") {
    return true;
  }
  return !/major screen change/i.test(transition.inferredTransition);
}

function buildInteractionSegmentSummary(
  segmentTransitions: NonNullable<TransitionsManifest["transitions"]>,
  involvedFrames: OcrFrame[],
  appNames: string[],
) {
  const kinds = segmentTransitions.map((transition) => transition.transitionKind ?? "uncertain");
  const lowerLabels = segmentTransitions.map((transition) => transition.inferredTransition.toLowerCase());
  const appLabel = appNames[0] ?? "The interface";
  const stepLines = involvedFrames
    .flatMap((frame) => frame.lines.map((line) => cleanDisplayLine(line.text)))
    .filter((line) => /^step \d+/i.test(line))
    .slice(0, 4);
  const signInEvidence = involvedFrames
    .flatMap((frame) => frame.lines.map((line) => cleanDisplayLine(line.text)))
    .filter((line) => /\bsign\s?in\b/i.test(line) || /password/i.test(line) || /add printers/i.test(line))
    .slice(0, 4);

  if (lowerLabels.some((label) => /sign-in screen/i.test(label))) {
    return {
      summary: `${appLabel} moved into an authentication step.`,
      evidence: unique(signInEvidence).slice(0, 4),
    };
  }

  if (kinds.includes("scroll-change") && kinds.includes("dialog-change")) {
    return {
      summary:
        stepLines.length >= 2
          ? `${appLabel} progressed through a guided same-screen workflow before opening a focused panel.`
          : `${appLabel} scrolled through a same-screen workflow and changed a focused panel.`,
      evidence: unique(stepLines).slice(0, 4),
    };
  }

  if (kinds.includes("dialog-change")) {
    return {
      summary: `${appLabel} changed a focused panel or guided step.`,
      evidence: unique(stepLines).slice(0, 4),
    };
  }

  if (kinds.includes("scroll-change")) {
    return {
      summary: `${appLabel} scrolled through a dense same-screen flow.`,
      evidence: unique(stepLines).slice(0, 4),
    };
  }

  return {
    summary: `${appLabel} changed state within the same screen.`,
    evidence: unique(stepLines.length > 0 ? stepLines : signInEvidence).slice(0, 4),
  };
}

function buildInteractionSegments(
  transitions: TransitionsManifest | null,
  frames: OcrFrame[],
  appNames: string[],
): StoryboardSummaryManifest["interactionSegments"] {
  if (!transitions?.transitions?.length) return [];
  const frameMap = new Map(frames.map((frame) => [frame.index, frame]));
  const segmentTransitions = transitions.transitions.filter(isSegmentWorthyTransition);
  if (segmentTransitions.length === 0) return [];

  const groups: Array<NonNullable<TransitionsManifest["transitions"]>> = [];
  let currentGroup: NonNullable<TransitionsManifest["transitions"]> = [];

  for (const transition of segmentTransitions) {
    const previous = currentGroup[currentGroup.length - 1];
    const withinFrameGap = !previous || transition.fromFrameIndex <= previous.toFrameIndex + 1;
    const withinTimeGap =
      !previous ||
      typeof previous.toTimestampSeconds !== "number" ||
      typeof transition.fromTimestampSeconds !== "number" ||
      transition.fromTimestampSeconds - previous.toTimestampSeconds <= 18;
    if (!previous || (withinFrameGap && withinTimeGap)) {
      currentGroup.push(transition);
      continue;
    }
    groups.push(currentGroup);
    currentGroup = [transition];
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  return groups.map((group) => {
    const startFrameIndex = group[0].fromFrameIndex;
    const endFrameIndex = group[group.length - 1].toFrameIndex;
    const involvedFrames = frames.filter((frame) => frame.index >= startFrameIndex && frame.index <= endFrameIndex);
    const { summary, evidence } = buildInteractionSegmentSummary(group, involvedFrames, appNames);
    return {
      startFrameIndex,
      endFrameIndex,
      startTimestampSeconds:
        group[0].fromTimestampSeconds ?? frameMap.get(startFrameIndex)?.timestampSeconds ?? startFrameIndex,
      endTimestampSeconds:
        group[group.length - 1].toTimestampSeconds ?? frameMap.get(endFrameIndex)?.timestampSeconds ?? endFrameIndex,
      transitionKinds: group.map((transition) => transition.transitionKind ?? "uncertain"),
      summary,
      evidence,
    };
  });
}

export async function understandStoryboard(input: StoryboardUnderstandRequest) {
  const { ocrPath, manifest } = await readOcrManifest(input);
  const transitions = await readTransitions(manifest.storyboardDir);
  const storyboardFallback = await readStoryboardSamplingFallback(manifest.storyboardDir);
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
    sampling: buildSamplingSummary(manifest, storyboardFallback),
    interactionSegments: buildInteractionSegments(transitions, manifest.frames, appNames),
    likelyFlow: buildLikelyFlow(transitions),
    likelyCapabilities: buildClaims(manifest.frames),
    textDominance: buildTextDominanceSummary(manifest.frames),
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
