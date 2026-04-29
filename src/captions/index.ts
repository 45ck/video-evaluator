export type CaptionReviewSchemaVersion =
  | "caption.ocr.v1"
  | "caption.quality.v1"
  | "caption.sync.v1";

export interface CaptionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptionCue {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  region?: string;
  lines?: string[];
  metadata?: Record<string, unknown>;
}

export interface CaptionOcrBox {
  id?: string;
  timestampSeconds?: number;
  startSeconds?: number;
  endSeconds?: number;
  text: string;
  confidence?: number;
  box?: CaptionBox;
  imageWidth?: number;
  imageHeight?: number;
  region?: string;
  metadata?: Record<string, unknown>;
}

export type CaptionSidecarSource = string | CaptionCue[] | Record<string, unknown>;

export interface CaptionRegion {
  name: string;
  box: CaptionBox;
}

export interface CaptionReviewOptions {
  regions?: CaptionRegion[];
  targetRegions?: string[];
  videoDurationSeconds?: number;
  minCueDurationSeconds?: number;
  maxCueDurationSeconds?: number;
  minGapSeconds?: number;
  maxCharsPerSecond?: number;
  maxLineLength?: number;
  maxLinesPerCue?: number;
  maxSyncDriftSeconds?: number;
  syncSearchWindowSeconds?: number;
  minTextSimilarity?: number;
  minOcrConfidence?: number;
  minRegionOverlap?: number;
  createdAt?: string;
}

export interface CaptionIssue {
  severity: "info" | "warn" | "fail";
  code: string;
  message: string;
  cueId?: string;
  ocrBoxId?: string;
  value?: number;
  threshold?: number;
}

export interface CaptionQualityReview {
  schemaVersion: "caption.quality.v1";
  createdAt: string;
  metrics: {
    cueCount: number;
    videoDurationSeconds?: number;
    captionedSeconds: number;
    coverageRatio?: number;
    averageCueDurationSeconds: number;
    averageGapSeconds: number;
    maxGapSeconds: number;
    averageCharsPerSecond: number;
    maxCharsPerSecond: number;
    averageLineLength: number;
    maxLineLength: number;
    maxLinesPerCue: number;
    readabilityPassRatio: number;
  };
  issues: CaptionIssue[];
}

export interface CaptionOcrReview {
  schemaVersion: "caption.ocr.v1";
  createdAt: string;
  status: "ready" | "unavailable";
  regions: CaptionRegion[];
  metrics: {
    expectedCueCount: number;
    providedOcrBoxCount: number;
    regionOcrBoxCount: number;
    matchedCueCount: number;
    textCoverageRatio: number;
    averageTextSimilarity: number;
    averageConfidence?: number;
  };
  issues: CaptionIssue[];
}

export interface CaptionSyncMatch {
  cueId: string;
  ocrBoxId?: string;
  cueStartSeconds: number;
  cueEndSeconds: number;
  ocrStartSeconds?: number;
  ocrEndSeconds?: number;
  driftSeconds?: number;
  textSimilarity?: number;
  status: "matched" | "missing";
}

export interface CaptionSyncReview {
  schemaVersion: "caption.sync.v1";
  createdAt: string;
  status: "ready" | "unavailable";
  metrics: {
    expectedCueCount: number;
    providedOcrBoxCount: number;
    matchedCueCount: number;
    coverageRatio: number;
    averageAbsDriftSeconds?: number;
    maxAbsDriftSeconds?: number;
    withinToleranceRatio?: number;
    averageTextSimilarity?: number;
  };
  matches: CaptionSyncMatch[];
  issues: CaptionIssue[];
}

const DEFAULT_OPTIONS = {
  minCueDurationSeconds: 0.8,
  maxCueDurationSeconds: 7,
  minGapSeconds: 0.08,
  maxCharsPerSecond: 20,
  maxLineLength: 42,
  maxLinesPerCue: 2,
  maxSyncDriftSeconds: 0.35,
  syncSearchWindowSeconds: 1.5,
  minTextSimilarity: 0.45,
  minOcrConfidence: 0,
  minRegionOverlap: 0.25,
} as const;

const DEFAULT_REGIONS: CaptionRegion[] = [
  { name: "bottom", box: { x: 0, y: 0.62, width: 1, height: 0.38 } },
];

type EffectiveCaptionReviewOptions = CaptionReviewOptions &
  Required<
    Pick<
      CaptionReviewOptions,
      | "minCueDurationSeconds"
      | "maxCueDurationSeconds"
      | "minGapSeconds"
      | "maxCharsPerSecond"
      | "maxLineLength"
      | "maxLinesPerCue"
    >
  >;

export function parseCaptionSidecar(input: CaptionSidecarSource): CaptionCue[] {
  if (typeof input !== "string") return parseCaptionJson(input);
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseCaptionJson(JSON.parse(trimmed) as unknown);
  }
  if (/^WEBVTT\b/i.test(trimmed)) return parseWebVtt(trimmed);
  return parseSrt(trimmed);
}

export function reviewCaptionQuality(
  sidecar: CaptionSidecarSource,
  options: CaptionReviewOptions = {},
): CaptionQualityReview {
  const cues = normalizeCueInput(sidecar);
  const effective = { ...DEFAULT_OPTIONS, ...options };
  const issues: CaptionIssue[] = [];
  const sorted = sortCues(cues);
  const gaps = sorted.slice(1).map((cue, index) => Math.max(0, cue.startSeconds - sorted[index].endSeconds));
  const cueDurations = sorted.map((cue) => duration(cue));
  const captionedSeconds = mergeIntervals(sorted.map((cue) => [cue.startSeconds, cue.endSeconds])).reduce(
    (sum, [start, end]) => sum + Math.max(0, end - start),
    0,
  );
  let readableCount = 0;
  const cueStats = sorted.map((cue) => {
    const lines = captionLines(cue);
    const lineLengths = lines.map((line) => normalizedText(line).length);
    const cps = normalizedText(cue.text).length / Math.max(0.001, duration(cue));
    const cueIssues: string[] = [];

    if (duration(cue) < effective.minCueDurationSeconds) cueIssues.push("short-duration");
    if (duration(cue) > effective.maxCueDurationSeconds) cueIssues.push("long-duration");
    if (cps > effective.maxCharsPerSecond) cueIssues.push("high-cps");
    if (Math.max(0, ...lineLengths) > effective.maxLineLength) cueIssues.push("long-line");
    if (lines.length > effective.maxLinesPerCue) cueIssues.push("too-many-lines");

    if (cueIssues.length === 0) readableCount++;
    for (const code of cueIssues) {
      issues.push(buildReadabilityIssue(code, cue, cps, lineLengths.length > 0 ? Math.max(...lineLengths) : 0, effective));
    }

    return { cps, lineLengths, lineCount: lines.length };
  });

  for (const [index, gap] of gaps.entries()) {
    if (gap > 0 && gap < effective.minGapSeconds) {
      issues.push({
        severity: "warn",
        code: "tight-gap",
        message: "Caption cues have a very small gap between them.",
        cueId: sorted[index + 1].id,
        value: round(gap),
        threshold: effective.minGapSeconds,
      });
    }
  }

  const videoDurationSeconds = options.videoDurationSeconds;
  const coverageRatio =
    typeof videoDurationSeconds === "number" && videoDurationSeconds > 0
      ? roundRatio(captionedSeconds / videoDurationSeconds)
      : undefined;

  return {
    schemaVersion: "caption.quality.v1",
    createdAt: options.createdAt ?? new Date().toISOString(),
    metrics: {
      cueCount: sorted.length,
      videoDurationSeconds,
      captionedSeconds: round(captionedSeconds),
      coverageRatio,
      averageCueDurationSeconds: average(cueDurations),
      averageGapSeconds: average(gaps),
      maxGapSeconds: round(Math.max(0, ...gaps)),
      averageCharsPerSecond: average(cueStats.map((stat) => stat.cps)),
      maxCharsPerSecond: round(Math.max(0, ...cueStats.map((stat) => stat.cps))),
      averageLineLength: average(cueStats.flatMap((stat) => stat.lineLengths)),
      maxLineLength: Math.max(0, ...cueStats.flatMap((stat) => stat.lineLengths)),
      maxLinesPerCue: Math.max(0, ...cueStats.map((stat) => stat.lineCount)),
      readabilityPassRatio: roundRatio(readableCount / Math.max(1, sorted.length)),
    },
    issues,
  };
}

export function reviewCaptionOcr(
  sidecar: CaptionSidecarSource,
  ocrBoxes: CaptionOcrBox[] | undefined,
  options: CaptionReviewOptions = {},
): CaptionOcrReview {
  const cues = sortCues(normalizeCueInput(sidecar));
  const boxes = normalizeOcrBoxes(ocrBoxes ?? [], options);
  const regionBoxes = filterOcrBoxesByRegion(boxes, options);
  const issues: CaptionIssue[] = [];

  if (!ocrBoxes || ocrBoxes.length === 0) {
    return {
      schemaVersion: "caption.ocr.v1",
      createdAt: options.createdAt ?? new Date().toISOString(),
      status: "unavailable",
      regions: effectiveRegions(options),
      metrics: {
        expectedCueCount: cues.length,
        providedOcrBoxCount: 0,
        regionOcrBoxCount: 0,
        matchedCueCount: 0,
        textCoverageRatio: 0,
        averageTextSimilarity: 0,
      },
      issues: [
        {
          severity: "info",
          code: "no-ocr-boxes",
          message: "No OCR boxes were provided; caption OCR review was skipped.",
        },
      ],
    };
  }

  const matches = matchCuesToOcr(cues, regionBoxes, options);
  const matched = matches.filter((match) => match.status === "matched");
  const averageTextSimilarity = average(
    matched.map((match) => match.textSimilarity).filter((value): value is number => value !== undefined),
  );

  for (const cue of cues) {
    if (!matched.some((match) => match.cueId === cue.id)) {
      issues.push({
        severity: "warn",
        code: "caption-not-seen-in-ocr",
        message: "Expected caption cue was not matched to a provided OCR box.",
        cueId: cue.id,
      });
    }
  }

  return {
    schemaVersion: "caption.ocr.v1",
    createdAt: options.createdAt ?? new Date().toISOString(),
    status: "ready",
    regions: effectiveRegions(options),
    metrics: {
      expectedCueCount: cues.length,
      providedOcrBoxCount: ocrBoxes.length,
      regionOcrBoxCount: regionBoxes.length,
      matchedCueCount: matched.length,
      textCoverageRatio: roundRatio(matched.length / Math.max(1, cues.length)),
      averageTextSimilarity,
      averageConfidence: average(
        regionBoxes.map((box) => box.confidence).filter((value): value is number => value !== undefined),
      ),
    },
    issues,
  };
}

export function reviewCaptionSync(
  sidecar: CaptionSidecarSource,
  ocrBoxes: CaptionOcrBox[] | undefined,
  options: CaptionReviewOptions = {},
): CaptionSyncReview {
  const cues = sortCues(normalizeCueInput(sidecar));
  const boxes = filterOcrBoxesByRegion(normalizeOcrBoxes(ocrBoxes ?? [], options), options);

  if (!ocrBoxes || ocrBoxes.length === 0) {
    return {
      schemaVersion: "caption.sync.v1",
      createdAt: options.createdAt ?? new Date().toISOString(),
      status: "unavailable",
      metrics: {
        expectedCueCount: cues.length,
        providedOcrBoxCount: 0,
        matchedCueCount: 0,
        coverageRatio: 0,
      },
      matches: cues.map((cue) => ({
        cueId: cue.id,
        cueStartSeconds: cue.startSeconds,
        cueEndSeconds: cue.endSeconds,
        status: "missing",
      })),
      issues: [
        {
          severity: "info",
          code: "no-ocr-boxes",
          message: "No OCR boxes were provided; caption sync review was skipped.",
        },
      ],
    };
  }

  const matches = matchCuesToOcr(cues, boxes, options);
  const matched = matches.filter((match) => match.status === "matched");
  const drifts = matched.map((match) => Math.abs(match.driftSeconds ?? 0));
  const maxSyncDriftSeconds = options.maxSyncDriftSeconds ?? DEFAULT_OPTIONS.maxSyncDriftSeconds;
  const issues: CaptionIssue[] = [];

  for (const match of matches) {
    if (match.status === "missing") {
      issues.push({
        severity: "warn",
        code: "missing-ocr-match",
        message: "Expected caption cue did not have a time-aligned OCR match.",
        cueId: match.cueId,
      });
      continue;
    }
    const drift = Math.abs(match.driftSeconds ?? 0);
    if (drift > maxSyncDriftSeconds) {
      issues.push({
        severity: "warn",
        code: "caption-drift",
        message: "OCR caption timing drift exceeds tolerance.",
        cueId: match.cueId,
        ocrBoxId: match.ocrBoxId,
        value: round(drift),
        threshold: maxSyncDriftSeconds,
      });
    }
  }

  return {
    schemaVersion: "caption.sync.v1",
    createdAt: options.createdAt ?? new Date().toISOString(),
    status: "ready",
    metrics: {
      expectedCueCount: cues.length,
      providedOcrBoxCount: ocrBoxes.length,
      matchedCueCount: matched.length,
      coverageRatio: roundRatio(matched.length / Math.max(1, cues.length)),
      averageAbsDriftSeconds: matched.length > 0 ? average(drifts) : undefined,
      maxAbsDriftSeconds: matched.length > 0 ? round(Math.max(...drifts)) : undefined,
      withinToleranceRatio:
        matched.length > 0
          ? roundRatio(drifts.filter((drift) => drift <= maxSyncDriftSeconds).length / matched.length)
          : undefined,
      averageTextSimilarity:
        matched.length > 0
          ? average(matched.map((match) => match.textSimilarity).filter((value): value is number => value !== undefined))
          : undefined,
    },
    matches,
    issues,
  };
}

function parseCaptionJson(input: unknown): CaptionCue[] {
  const source = Array.isArray(input)
    ? input
    : input && typeof input === "object"
      ? ((input as Record<string, unknown>).cues ??
        (input as Record<string, unknown>).captions ??
        (input as Record<string, unknown>).subtitles)
      : [];
  if (!Array.isArray(source)) return [];

  return source
    .map((entry, index): CaptionCue | null => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const startSeconds = numberFrom(record.startSeconds ?? record.start ?? record.from);
      const endSeconds = numberFrom(record.endSeconds ?? record.end ?? record.to);
      const text = normalizedText(String(record.text ?? record.caption ?? record.value ?? ""));
      if (startSeconds === undefined || endSeconds === undefined || !text) return null;
      return {
        id: String(record.id ?? `cue-${String(index + 1).padStart(4, "0")}`),
        startSeconds,
        endSeconds,
        text,
        region: typeof record.region === "string" ? record.region : undefined,
        lines: Array.isArray(record.lines) ? record.lines.map(String) : undefined,
        metadata: record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : undefined,
      };
    })
    .filter((cue): cue is CaptionCue => cue !== null);
}

function parseWebVtt(input: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = input.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;
    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const startSeconds = parseTimestamp(startRaw);
    const endSeconds = parseTimestamp(endRaw);
    const textLines = lines.slice(timingIndex + 1).map(stripCaptionMarkup).filter(Boolean);
    const text = normalizedText(textLines.join(" "));
    if (startSeconds === undefined || endSeconds === undefined || !text) continue;
    cues.push({
      id: `cue-${String(cues.length + 1).padStart(4, "0")}`,
      startSeconds,
      endSeconds,
      text,
      lines: textLines,
    });
  }
  return cues;
}

function parseSrt(input: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = input.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;
    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const startSeconds = parseTimestamp(startRaw);
    const endSeconds = parseTimestamp(endRaw);
    const textLines = lines.slice(timingIndex + 1).map(stripCaptionMarkup).filter(Boolean);
    const text = normalizedText(textLines.join(" "));
    if (startSeconds === undefined || endSeconds === undefined || !text) continue;
    cues.push({
      id: `cue-${String(cues.length + 1).padStart(4, "0")}`,
      startSeconds,
      endSeconds,
      text,
      lines: textLines,
    });
  }
  return cues;
}

function normalizeCueInput(input: CaptionSidecarSource): CaptionCue[] {
  if (Array.isArray(input) && input.every((entry) => entry && typeof entry === "object" && "startSeconds" in entry)) {
    return input as CaptionCue[];
  }
  return parseCaptionSidecar(input);
}

function normalizeOcrBoxes(ocrBoxes: CaptionOcrBox[], options: CaptionReviewOptions): CaptionOcrBox[] {
  const minOcrConfidence = options.minOcrConfidence ?? DEFAULT_OPTIONS.minOcrConfidence;
  return ocrBoxes
    .map((box, index) => ({
      ...box,
      id: box.id ?? `ocr-${String(index + 1).padStart(4, "0")}`,
      text: normalizedText(box.text),
      box: box.box ? normalizeBox(box.box, box.imageWidth, box.imageHeight) : undefined,
    }))
    .filter((box) => box.text.length > 0)
    .filter((box) => box.confidence === undefined || box.confidence >= minOcrConfidence);
}

function filterOcrBoxesByRegion(boxes: CaptionOcrBox[], options: CaptionReviewOptions): CaptionOcrBox[] {
  const regions = effectiveRegions(options);
  const targets = new Set(options.targetRegions ?? regions.map((region) => region.name));
  const minRegionOverlap = options.minRegionOverlap ?? DEFAULT_OPTIONS.minRegionOverlap;
  return boxes.filter((box) => {
    if (box.region && targets.has(box.region)) return true;
    if (!box.box) return true;
    return regions
      .filter((region) => targets.has(region.name))
      .some((region) => overlapRatio(box.box!, region.box) >= minRegionOverlap);
  });
}

function matchCuesToOcr(
  cues: CaptionCue[],
  ocrBoxes: CaptionOcrBox[],
  options: CaptionReviewOptions,
): CaptionSyncMatch[] {
  const minTextSimilarity = options.minTextSimilarity ?? DEFAULT_OPTIONS.minTextSimilarity;
  const syncSearchWindowSeconds = options.syncSearchWindowSeconds ?? DEFAULT_OPTIONS.syncSearchWindowSeconds;
  const usedBoxIds = new Set<string>();

  return cues.map((cue) => {
    const cueCenter = (cue.startSeconds + cue.endSeconds) / 2;
    let best:
      | {
          box: CaptionOcrBox;
          similarity: number;
          driftSeconds: number;
          score: number;
          startSeconds: number;
          endSeconds: number;
        }
      | undefined;

    for (const box of ocrBoxes) {
      const boxId = box.id ?? "";
      if (usedBoxIds.has(boxId)) continue;
      const startSeconds = box.startSeconds ?? box.timestampSeconds;
      const endSeconds = box.endSeconds ?? box.timestampSeconds ?? box.startSeconds;
      if (startSeconds === undefined || endSeconds === undefined) continue;
      const ocrCenter = (startSeconds + endSeconds) / 2;
      const driftSeconds = ocrCenter - cueCenter;
      const timeDistance = Math.abs(driftSeconds);
      const overlapsCue = endSeconds >= cue.startSeconds && startSeconds <= cue.endSeconds;
      if (!overlapsCue && timeDistance > syncSearchWindowSeconds) continue;

      const similarity = textSimilarity(cue.text, box.text);
      if (similarity < minTextSimilarity) continue;
      const score = similarity * 2 - timeDistance;
      if (!best || score > best.score) {
        best = { box, similarity, driftSeconds, score, startSeconds, endSeconds };
      }
    }

    if (!best) {
      return {
        cueId: cue.id,
        cueStartSeconds: cue.startSeconds,
        cueEndSeconds: cue.endSeconds,
        status: "missing",
      };
    }

    if (best.box.id) usedBoxIds.add(best.box.id);
    return {
      cueId: cue.id,
      ocrBoxId: best.box.id,
      cueStartSeconds: cue.startSeconds,
      cueEndSeconds: cue.endSeconds,
      ocrStartSeconds: best.startSeconds,
      ocrEndSeconds: best.endSeconds,
      driftSeconds: round(best.driftSeconds),
      textSimilarity: roundRatio(best.similarity),
      status: "matched",
    };
  });
}

function buildReadabilityIssue(
  code: string,
  cue: CaptionCue,
  cps: number,
  maxLineLength: number,
  options: EffectiveCaptionReviewOptions,
): CaptionIssue {
  if (code === "short-duration") {
    return {
      severity: "warn",
      code,
      message: "Caption cue duration is very short.",
      cueId: cue.id,
      value: round(duration(cue)),
      threshold: options.minCueDurationSeconds,
    };
  }
  if (code === "long-duration") {
    return {
      severity: "warn",
      code,
      message: "Caption cue duration is long and may feel stale.",
      cueId: cue.id,
      value: round(duration(cue)),
      threshold: options.maxCueDurationSeconds,
    };
  }
  if (code === "high-cps") {
    return {
      severity: "warn",
      code,
      message: "Caption reading speed exceeds the configured threshold.",
      cueId: cue.id,
      value: round(cps),
      threshold: options.maxCharsPerSecond,
    };
  }
  if (code === "long-line") {
    return {
      severity: "warn",
      code,
      message: "Caption line length exceeds the configured threshold.",
      cueId: cue.id,
      value: maxLineLength,
      threshold: options.maxLineLength,
    };
  }
  return {
    severity: "warn",
    code,
    message: "Caption cue has more lines than the configured threshold.",
    cueId: cue.id,
    value: captionLines(cue).length,
    threshold: options.maxLinesPerCue,
  };
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return undefined;
  return round(hours * 3600 + minutes * 60 + seconds);
}

function numberFrom(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function captionLines(cue: CaptionCue): string[] {
  if (cue.lines && cue.lines.length > 0) return cue.lines.map(normalizedText).filter(Boolean);
  return cue.text.split(/\n+/).map(normalizedText).filter(Boolean);
}

function sortCues(cues: CaptionCue[]): CaptionCue[] {
  return [...cues]
    .filter((cue) => Number.isFinite(cue.startSeconds) && Number.isFinite(cue.endSeconds) && cue.text)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
}

function duration(cue: CaptionCue): number {
  return Math.max(0, cue.endSeconds - cue.startSeconds);
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripCaptionMarkup(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\{\\[^}]+}/g, "").trim();
}

function effectiveRegions(options: CaptionReviewOptions): CaptionRegion[] {
  return (options.regions && options.regions.length > 0 ? options.regions : DEFAULT_REGIONS).map((region) => ({
    ...region,
    box: normalizeBox(region.box),
  }));
}

function normalizeBox(box: CaptionBox, imageWidth?: number, imageHeight?: number): CaptionBox {
  if (imageWidth && imageHeight && (box.x > 1 || box.y > 1 || box.width > 1 || box.height > 1)) {
    return {
      x: box.x / imageWidth,
      y: box.y / imageHeight,
      width: box.width / imageWidth,
      height: box.height / imageHeight,
    };
  }
  return box;
}

function overlapRatio(a: CaptionBox, b: CaptionBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  const area = Math.max(0.000001, a.width * a.height);
  return overlapArea / area;
}

function textSimilarity(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / Math.max(1, union);
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort(([leftStart], [rightStart]) => leftStart - rightStart);
  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) {
      merged.push([...interval]);
    } else {
      previous[1] = Math.max(previous[1], interval[1]);
    }
  }
  return merged;
}

function average(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return 0;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function roundRatio(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}
