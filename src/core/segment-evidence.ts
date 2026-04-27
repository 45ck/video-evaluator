import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { intakeBundle } from "./bundle.js";
import type { SegmentEvidenceRequest } from "./schemas.js";

type SegmentEvidenceStatus = "usable" | "weak" | "empty";

interface ShotRecord {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  representativeTimestampSeconds?: number;
  representativeFramePath?: string;
}

interface StoryboardFrameRecord {
  index: number;
  timestampSeconds: number;
  imagePath: string;
  samplingReason?: string;
  samplingSignal?: string;
}

interface OcrFrameRecord extends StoryboardFrameRecord {
  lines?: Array<{ text?: string; confidence?: number; region?: string; evidenceRole?: string }>;
  semanticLines?: Array<{ text?: string; confidence?: number; region?: string; evidenceRole?: string }>;
  quality?: { status?: "usable" | "weak" | "reject"; reasons?: string[] };
}

interface TransitionRecord {
  fromFrameIndex: number;
  toFrameIndex: number;
  fromTimestampSeconds: number;
  toTimestampSeconds: number;
  transitionKind?: string;
  inferredTransition?: string;
  confidence?: number;
  evidence?: string[];
}

interface TimelineRecord {
  id?: string;
  kind?: string;
  sourceType?: string;
  startSeconds: number;
  endSeconds: number;
  text?: string;
  action?: string;
  confidence?: number;
}

export interface SegmentEvidenceTextItem {
  source: "ocr" | "timeline";
  text: string;
  timestampSeconds?: number;
  startSeconds?: number;
  endSeconds?: number;
  kind?: string;
  confidence?: number;
}

export interface SegmentEvidenceRecord {
  index: number;
  sourceShotIndex: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  representativeTimestampSeconds?: number;
  representativeFramePath?: string;
  evidenceStatus: SegmentEvidenceStatus;
  evidenceCounts: {
    storyboardFrames: number;
    usableOcrFrames: number;
    weakOcrFrames: number;
    rejectedOcrFrames: number;
    timelineItems: number;
    transitions: number;
  };
  storyboardFrames: Array<{
    index: number;
    timestampSeconds: number;
    imagePath: string;
    samplingReason?: string;
    samplingSignal?: string;
    ocrQuality?: string;
  }>;
  timelineItems: Array<{
    id?: string;
    kind?: string;
    sourceType?: string;
    startSeconds: number;
    endSeconds: number;
    text?: string;
    action?: string;
  }>;
  transitions: Array<{
    fromFrameIndex: number;
    toFrameIndex: number;
    fromTimestampSeconds: number;
    toTimestampSeconds: number;
    transitionKind?: string;
    inferredTransition?: string;
    confidence?: number;
  }>;
  textEvidence: SegmentEvidenceTextItem[];
  notes: string[];
}

export interface SegmentEvidenceManifest {
  schemaVersion: 1;
  createdAt: string;
  rootDir: string | null;
  videoPath: string | null;
  sourceArtifacts: Record<string, string>;
  segments: SegmentEvidenceRecord[];
  summary: {
    segmentCount: number;
    usableSegments: number;
    weakSegments: number;
    emptySegments: number;
    sourceArtifacts: string[];
  };
}

export async function buildSegmentEvidence(input: SegmentEvidenceRequest) {
  const bundle = await intakeBundle(input);
  const shotsPath = bundle.artifacts["video.shots.json"];
  if (!shotsPath) {
    throw new Error("segment-evidence requires video.shots.json. Run video-shots first.");
  }
  const rootDir = bundle.rootDir ?? resolve(input.outputDir ?? ".");
  const shots = await readShots(shotsPath);
  const storyboardFrames = await readStoryboardFrames(bundle.artifacts["storyboard.manifest.json"]);
  const ocrFrames = await readOcrFrames(bundle.artifacts["storyboard.ocr.json"]);
  const transitions = await readTransitions(bundle.artifacts["storyboard.transitions.json"]);
  const timelineItems = await readTimelineItems(bundle.artifacts["timeline.evidence.json"]);

  const ocrByFrameIndex = new Map(ocrFrames.map((frame) => [frame.index, frame]));
  const segments = shots.map((shot, index) =>
    buildSegment({
      shot,
      index: index + 1,
      storyboardFrames,
      ocrByFrameIndex,
      transitions,
      timelineItems,
      maxTextItems: input.maxTextItemsPerSegment,
    }),
  );

  const manifest: SegmentEvidenceManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    rootDir: bundle.rootDir,
    videoPath: bundle.videoPath,
    sourceArtifacts: pickSourceArtifacts(bundle.artifacts),
    segments,
    summary: {
      segmentCount: segments.length,
      usableSegments: segments.filter((segment) => segment.evidenceStatus === "usable").length,
      weakSegments: segments.filter((segment) => segment.evidenceStatus === "weak").length,
      emptySegments: segments.filter((segment) => segment.evidenceStatus === "empty").length,
      sourceArtifacts: Object.keys(pickSourceArtifacts(bundle.artifacts)),
    },
  };

  const manifestPath = resolve(input.outputPath ?? join(rootDir, "segment.evidence.json"));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, manifest };
}

function buildSegment(input: {
  shot: ShotRecord;
  index: number;
  storyboardFrames: StoryboardFrameRecord[];
  ocrByFrameIndex: Map<number, OcrFrameRecord>;
  transitions: TransitionRecord[];
  timelineItems: TimelineRecord[];
  maxTextItems: number;
}): SegmentEvidenceRecord {
  const { shot } = input;
  const storyboardFrames = input.storyboardFrames.filter((frame) => containsTimestamp(shot, frame.timestampSeconds));
  const ocrFrames = storyboardFrames
    .map((frame) => input.ocrByFrameIndex.get(frame.index))
    .filter((frame): frame is OcrFrameRecord => Boolean(frame));
  const timelineItems = input.timelineItems.filter((item) => overlaps(shot.startSeconds, shot.endSeconds, item.startSeconds, item.endSeconds));
  const transitions = input.transitions.filter((transition) =>
    containsTimestamp(shot, midpoint(transition.fromTimestampSeconds, transition.toTimestampSeconds)),
  );
  const usableOcrFrames = ocrFrames.filter((frame) => frame.quality?.status === "usable").length;
  const weakOcrFrames = ocrFrames.filter((frame) => frame.quality?.status === "weak").length;
  const rejectedOcrFrames = ocrFrames.filter((frame) => frame.quality?.status === "reject").length;
  const textEvidence = collectTextEvidence(ocrFrames, timelineItems, input.maxTextItems);
  const evidenceStatus = classifyEvidenceStatus({
    storyboardFrameCount: storyboardFrames.length,
    usableOcrFrames,
    weakOcrFrames,
    timelineItemCount: timelineItems.length,
    transitionCount: transitions.length,
    textEvidenceCount: textEvidence.length,
  });

  return {
    index: input.index,
    sourceShotIndex: shot.index,
    startSeconds: shot.startSeconds,
    endSeconds: shot.endSeconds,
    durationSeconds: shot.durationSeconds,
    representativeTimestampSeconds: shot.representativeTimestampSeconds,
    representativeFramePath: shot.representativeFramePath,
    evidenceStatus,
    evidenceCounts: {
      storyboardFrames: storyboardFrames.length,
      usableOcrFrames,
      weakOcrFrames,
      rejectedOcrFrames,
      timelineItems: timelineItems.length,
      transitions: transitions.length,
    },
    storyboardFrames: storyboardFrames.map((frame) => ({
      index: frame.index,
      timestampSeconds: frame.timestampSeconds,
      imagePath: frame.imagePath,
      samplingReason: frame.samplingReason,
      samplingSignal: frame.samplingSignal,
      ocrQuality: input.ocrByFrameIndex.get(frame.index)?.quality?.status,
    })),
    timelineItems: timelineItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      sourceType: item.sourceType,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      text: item.text,
      action: item.action,
    })),
    transitions: transitions.map((transition) => ({
      fromFrameIndex: transition.fromFrameIndex,
      toFrameIndex: transition.toFrameIndex,
      fromTimestampSeconds: transition.fromTimestampSeconds,
      toTimestampSeconds: transition.toTimestampSeconds,
      transitionKind: transition.transitionKind,
      inferredTransition: transition.inferredTransition,
      confidence: transition.confidence,
    })),
    textEvidence,
    notes: buildNotes(evidenceStatus, storyboardFrames.length, textEvidence.length, timelineItems.length),
  };
}

function classifyEvidenceStatus(input: {
  storyboardFrameCount: number;
  usableOcrFrames: number;
  weakOcrFrames: number;
  timelineItemCount: number;
  transitionCount: number;
  textEvidenceCount: number;
}): SegmentEvidenceStatus {
  if (input.usableOcrFrames > 0 || input.timelineItemCount > 0) return "usable";
  if (input.storyboardFrameCount > 0 || input.weakOcrFrames > 0 || input.transitionCount > 0 || input.textEvidenceCount > 0) return "weak";
  return "empty";
}

function collectTextEvidence(
  ocrFrames: OcrFrameRecord[],
  timelineItems: TimelineRecord[],
  maxItems: number,
): SegmentEvidenceTextItem[] {
  const items: SegmentEvidenceTextItem[] = [];
  const seen = new Set<string>();
  for (const frame of ocrFrames) {
    const lines = frame.semanticLines && frame.semanticLines.length > 0 ? frame.semanticLines : frame.quality?.status === "reject" ? [] : frame.lines ?? [];
    for (const line of lines) {
      const text = normalizeText(line.text);
      if (!text || seen.has(`ocr:${text.toLowerCase()}`)) continue;
      seen.add(`ocr:${text.toLowerCase()}`);
      items.push({
        source: "ocr",
        text,
        timestampSeconds: frame.timestampSeconds,
        confidence: line.confidence,
        kind: line.evidenceRole,
      });
      if (items.length >= maxItems) return items;
    }
  }
  for (const item of timelineItems) {
    const text = normalizeText(item.text ?? item.action);
    if (!text || seen.has(`timeline:${text.toLowerCase()}`)) continue;
    seen.add(`timeline:${text.toLowerCase()}`);
    items.push({
      source: "timeline",
      text,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      confidence: item.confidence,
      kind: item.kind,
    });
    if (items.length >= maxItems) return items;
  }
  return items;
}

function buildNotes(
  status: SegmentEvidenceStatus,
  storyboardFrameCount: number,
  textEvidenceCount: number,
  timelineItemCount: number,
): string[] {
  const notes: string[] = [];
  if (status === "empty") notes.push("No overlapping storyboard, OCR, transition, or timeline evidence was found for this segment.");
  if (status === "weak") notes.push("Segment has structural evidence but limited usable text or timeline evidence.");
  if (storyboardFrameCount === 0) notes.push("No storyboard frame landed inside this shot; inspect the representative shot frame or source video before making visual claims.");
  if (textEvidenceCount === 0 && timelineItemCount === 0) notes.push("No text evidence is available for this segment.");
  return notes;
}

async function readShots(path: string): Promise<ShotRecord[]> {
  const parsed = await readJson<{ shots?: ShotRecord[] }>(path);
  return (parsed.shots ?? []).filter((shot) => Number.isFinite(shot.startSeconds) && Number.isFinite(shot.endSeconds));
}

async function readStoryboardFrames(path: string | undefined): Promise<StoryboardFrameRecord[]> {
  if (!path) return [];
  const parsed = await readJson<{ frames?: StoryboardFrameRecord[] }>(path);
  return (parsed.frames ?? []).filter((frame) => Number.isFinite(frame.timestampSeconds));
}

async function readOcrFrames(path: string | undefined): Promise<OcrFrameRecord[]> {
  if (!path) return [];
  const parsed = await readJson<{ frames?: OcrFrameRecord[] }>(path);
  return (parsed.frames ?? []).filter((frame) => Number.isFinite(frame.timestampSeconds));
}

async function readTransitions(path: string | undefined): Promise<TransitionRecord[]> {
  if (!path) return [];
  const parsed = await readJson<{ transitions?: TransitionRecord[] }>(path);
  return (parsed.transitions ?? []).filter(
    (transition) => Number.isFinite(transition.fromTimestampSeconds) && Number.isFinite(transition.toTimestampSeconds),
  );
}

async function readTimelineItems(path: string | undefined): Promise<TimelineRecord[]> {
  if (!path) return [];
  const parsed = await readJson<{ evidence?: TimelineRecord[] }>(path);
  return (parsed.evidence ?? []).filter((item) => Number.isFinite(item.startSeconds) && Number.isFinite(item.endSeconds));
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

function pickSourceArtifacts(artifacts: Record<string, string>): Record<string, string> {
  const names = [
    "video.shots.json",
    "storyboard.manifest.json",
    "storyboard.ocr.json",
    "storyboard.transitions.json",
    "storyboard.summary.json",
    "timeline.evidence.json",
  ];
  return Object.fromEntries(names.flatMap((name) => artifacts[name] ? [[name, artifacts[name]]] : []));
}

function containsTimestamp(shot: ShotRecord, timestampSeconds: number): boolean {
  return timestampSeconds >= shot.startSeconds && timestampSeconds <= shot.endSeconds;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA <= endB && startB <= endA;
}

function midpoint(startSeconds: number, endSeconds: number): number {
  return startSeconds + (endSeconds - startSeconds) / 2;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
