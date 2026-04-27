import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type TimelineEvidenceKind = "transcript" | "caption" | "action";
export type TimelineEvidenceSourceType = "timestamps-scene" | "timestamps-words" | "subtitles-vtt" | "events-json";

export interface TimelineEvidenceItem {
  id: string;
  kind: TimelineEvidenceKind;
  sourceType: TimelineEvidenceSourceType;
  sourcePath: string;
  startSeconds: number;
  endSeconds: number;
  text?: string;
  action?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface TimelineEvidenceManifest {
  schemaVersion: 1;
  createdAt: string;
  rootDir: string;
  sourceArtifacts: Record<string, string>;
  evidence: TimelineEvidenceItem[];
  summary: {
    transcriptItems: number;
    captionItems: number;
    actionItems: number;
    durationSeconds?: number;
  };
}

interface TimelineBuildInput {
  rootDir: string;
  artifacts: Record<string, string>;
  outputPath?: string;
}

interface WordTimestamp {
  word?: unknown;
  start?: unknown;
  end?: unknown;
  confidence?: unknown;
}

interface SceneTimestamp {
  sceneId?: unknown;
  audioStart?: unknown;
  audioEnd?: unknown;
  words?: unknown;
}

export async function buildTimelineEvidence(input: TimelineBuildInput): Promise<TimelineEvidenceManifest | null> {
  const rootDir = resolve(input.rootDir);
  const sourceArtifacts = collectTimelineSourceArtifacts(input.artifacts);
  const evidence: TimelineEvidenceItem[] = [];

  if (sourceArtifacts["timestamps.json"]) {
    evidence.push(...(await parseTimestampsEvidence(sourceArtifacts["timestamps.json"])));
  }
  if (sourceArtifacts["subtitles.vtt"]) {
    evidence.push(...(await parseWebVttEvidence(sourceArtifacts["subtitles.vtt"])));
  }
  if (sourceArtifacts["events.json"]) {
    evidence.push(...(await parseEventsEvidence(sourceArtifacts["events.json"])));
  }

  const sortedEvidence = evidence
    .filter((item) => Number.isFinite(item.startSeconds) && Number.isFinite(item.endSeconds))
    .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);

  if (sortedEvidence.length === 0) return null;

  const manifest: TimelineEvidenceManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    rootDir,
    sourceArtifacts,
    evidence: sortedEvidence.map((item, index) => ({
      ...item,
      id: `timeline-${String(index + 1).padStart(4, "0")}`,
    })),
    summary: {
      transcriptItems: sortedEvidence.filter((item) => item.kind === "transcript").length,
      captionItems: sortedEvidence.filter((item) => item.kind === "caption").length,
      actionItems: sortedEvidence.filter((item) => item.kind === "action").length,
      durationSeconds: inferDurationSeconds(sortedEvidence),
    },
  };

  await writeFile(input.outputPath ?? join(rootDir, "timeline.evidence.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function collectTimelineSourceArtifacts(artifacts: Record<string, string>): Record<string, string> {
  const sourceArtifacts: Record<string, string> = {};
  for (const name of ["timestamps.json", "subtitles.vtt", "events.json"]) {
    if (artifacts[name]) sourceArtifacts[name] = artifacts[name];
  }
  return sourceArtifacts;
}

async function parseTimestampsEvidence(path: string): Promise<TimelineEvidenceItem[]> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const scenes = Array.isArray(parsed.scenes) ? (parsed.scenes as SceneTimestamp[]) : [];
  const allWords = Array.isArray(parsed.allWords)
    ? (parsed.allWords as WordTimestamp[])
    : Array.isArray(parsed.words)
      ? (parsed.words as WordTimestamp[])
      : [];

  if (scenes.length > 0) {
    return scenes
      .map((scene, index): TimelineEvidenceItem | null => {
        const words = Array.isArray(scene.words) ? (scene.words as WordTimestamp[]) : [];
        const text = joinWords(words);
        const startSeconds = numberOrUndefined(scene.audioStart) ?? firstWordStart(words);
        const endSeconds = numberOrUndefined(scene.audioEnd) ?? lastWordEnd(words);
        if (startSeconds === undefined || endSeconds === undefined || !text) return null;
        return {
          id: `timestamps-scene-${index + 1}`,
          kind: "transcript",
          sourceType: "timestamps-scene",
          sourcePath: path,
          startSeconds,
          endSeconds,
          text,
          confidence: averageConfidence(words),
          metadata: {
            sceneId: typeof scene.sceneId === "string" ? scene.sceneId : undefined,
            wordCount: words.length,
          },
        };
      })
      .filter((item): item is TimelineEvidenceItem => item !== null);
  }

  const text = joinWords(allWords);
  const startSeconds = firstWordStart(allWords);
  const endSeconds = lastWordEnd(allWords);
  if (!text || startSeconds === undefined || endSeconds === undefined) return [];
  return [
    {
      id: "timestamps-words-1",
      kind: "transcript",
      sourceType: "timestamps-words",
      sourcePath: path,
      startSeconds,
      endSeconds,
      text,
      confidence: averageConfidence(allWords),
      metadata: { wordCount: allWords.length },
    },
  ];
}

async function parseEventsEvidence(path: string): Promise<TimelineEvidenceItem[]> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry, index): TimelineEvidenceItem | null => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const action = typeof record.action === "string" ? record.action : undefined;
      const startSeconds = numberOrUndefined(record.timestamp);
      const durationSeconds = numberOrUndefined(record.duration) ?? 0;
      if (!action || startSeconds === undefined) return null;
      return {
        id: `events-json-${index + 1}`,
        kind: "action",
        sourceType: "events-json",
        sourcePath: path,
        startSeconds,
        endSeconds: startSeconds + Math.max(0, durationSeconds),
        action,
        text: action,
        metadata: sanitizeMetadata(record, ["action", "timestamp", "duration"]),
      };
    })
    .filter((item): item is TimelineEvidenceItem => item !== null);
}

async function parseWebVttEvidence(path: string): Promise<TimelineEvidenceItem[]> {
  const raw = await readFile(path, "utf8");
  const cues: TimelineEvidenceItem[] = [];
  const blocks = raw.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;
    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const startSeconds = parseTimestamp(startRaw);
    const endSeconds = parseTimestamp(endRaw);
    const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (startSeconds === undefined || endSeconds === undefined || !text) continue;
    cues.push({
      id: `subtitles-vtt-${cues.length + 1}`,
      kind: "caption",
      sourceType: "subtitles-vtt",
      sourcePath: path,
      startSeconds,
      endSeconds,
      text,
    });
  }
  return cues;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return undefined;
  return Number((hours * 3600 + minutes * 60 + seconds).toFixed(3));
}

function joinWords(words: WordTimestamp[]): string {
  return words
    .map((word) => (typeof word.word === "string" ? word.word : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstWordStart(words: WordTimestamp[]): number | undefined {
  return words.map((word) => numberOrUndefined(word.start)).find((value) => value !== undefined);
}

function lastWordEnd(words: WordTimestamp[]): number | undefined {
  return [...words].reverse().map((word) => numberOrUndefined(word.end)).find((value) => value !== undefined);
}

function averageConfidence(words: WordTimestamp[]): number | undefined {
  const confidences = words.map((word) => numberOrUndefined(word.confidence)).filter((value): value is number => value !== undefined);
  if (confidences.length === 0) return undefined;
  return Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(3));
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function inferDurationSeconds(items: TimelineEvidenceItem[]): number | undefined {
  if (items.length === 0) return undefined;
  return Number(Math.max(...items.map((item) => item.endSeconds)).toFixed(3));
}

function sanitizeMetadata(record: Record<string, unknown>, excludedKeys: string[]): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (excludedKeys.includes(key)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) metadata[key] = value;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
