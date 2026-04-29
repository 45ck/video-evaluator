export interface TechnicalFrameMetrics {
  index?: number;
  timestampSeconds?: number;
  averageLuma?: number;
  meanLuma?: number;
  blackPixelRatio?: number;
  whitePixelRatio?: number;
  edgeBlackRatio?: number;
  edgeWhiteRatio?: number;
  contentBlackRatio?: number;
  contentWhiteRatio?: number;
  captionBandDetailRatio?: number;
  motionScoreFromPrevious?: number;
  differenceFromPrevious?: number;
}

export interface SceneCadenceSummary {
  passed: boolean;
  cutCount: number;
  intervalsSeconds: number[];
  medianCutIntervalSeconds: number;
  meanCutIntervalSeconds: number;
  maxCutIntervalSeconds: number;
  maxMedianCutIntervalSeconds: number;
  minCutCount: number;
}

export interface FreezeBlackWhiteSummary {
  totalFrames: number;
  comparisonCount: number;
  freezeEvents: number;
  freezeRatio: number;
  frozenComparisonFrames: number;
  blackFrames: number;
  blackRatio: number;
  whiteFrames: number;
  whiteRatio: number;
  maxBlackPixelRatio: number;
  maxWhitePixelRatio: number;
}

export interface EdgeGutterSummary {
  totalFrames: number;
  blackGutterFrames: number;
  blackGutterRatio: number;
  whiteEdgeFrames: number;
  whiteEdgeRatio: number;
  maxEdgeBlackRatio: number;
  maxEdgeWhiteRatio: number;
  frames: Array<{
    index?: number;
    timestampSeconds?: number;
    code: "black-gutter" | "white-edge";
    edgeRatio: number;
    contentExtremeRatio: number;
  }>;
}

export interface TemporalSignalSummary {
  flicker: {
    score: number;
    variance: number;
    meanDiff: number;
  };
  duplicateFrameRatio: number;
  duplicateRunCount: number;
  duplicateComparisonFrames: number;
  framesAnalyzed: number;
}

export interface AudioMetricInput {
  loudnessLUFS?: number;
  truePeakDBFS?: number;
  loudnessRange?: number;
  clippingRatio?: number;
  peakLevelDB?: number;
  snrDB?: number;
  meanVolumeDb?: number;
  maxVolumeDb?: number;
}

export interface AudioSignalSummary {
  loudnessLUFS: number;
  truePeakDBFS: number;
  loudnessRange: number;
  clippingRatio: number;
  peakLevelDB: number;
  snrDB: number;
  nearSilent: boolean;
  tooQuiet: boolean;
  tooLoud: boolean;
  clipped: boolean;
  truePeakExceeded: boolean;
}

export interface TechnicalSignalSummary {
  sceneCadence?: SceneCadenceSummary;
  freezeBlackWhite: FreezeBlackWhiteSummary;
  edgeGutter: EdgeGutterSummary;
  temporal: TemporalSignalSummary;
  audio?: AudioSignalSummary;
}

const DEFAULT_BLACK_FRAME_PIXEL_RATIO = 0.92;
const DEFAULT_WHITE_FRAME_PIXEL_RATIO = 0.92;
const DEFAULT_BLACK_LUMA_MAX = 10 / 255;
const DEFAULT_WHITE_LUMA_MIN = 245 / 255;
const DEFAULT_FREEZE_DIFFERENCE_THRESHOLD = 0.006;
const DEFAULT_FREEZE_MIN_RUN_FRAMES = 4;
const DEFAULT_EDGE_ARTIFACT_RATIO = 0.82;
const DEFAULT_MAX_CONTENT_EXTREME_RATIO_FOR_EDGE_ARTIFACT = 0.25;
const DEFAULT_DUPLICATE_DIFFERENCE_THRESHOLD = 0.006;
const DEFAULT_DUPLICATE_MIN_RUN_FRAMES = 3;
const DEFAULT_LOUDNESS_MIN_LUFS = -24;
const DEFAULT_LOUDNESS_MAX_LUFS = -8;
const DEFAULT_MAX_CLIPPING_RATIO = 0.01;
const DEFAULT_TRUE_PEAK_MAX_DBFS = -1;
const CRITICAL_SILENCE_MAX_LOUDNESS_LUFS = -45;
const CRITICAL_SILENCE_MAX_PEAK_LEVEL_DB = -35;

export function summarizeTechnicalSignals(input: {
  frames: TechnicalFrameMetrics[];
  durationSeconds?: number;
  cutTimesSeconds?: number[];
  audio?: AudioMetricInput;
  thresholds?: TechnicalSignalThresholds;
}): TechnicalSignalSummary {
  return {
    sceneCadence:
      input.durationSeconds !== undefined
        ? summarizeSceneCadence({
            durationSeconds: input.durationSeconds,
            cutTimesSeconds: input.cutTimesSeconds ?? [],
            maxMedianCutIntervalSeconds:
              input.thresholds?.maxMedianCutIntervalSeconds,
            minCutCount: input.thresholds?.minCutCount,
          })
        : undefined,
    freezeBlackWhite: summarizeFreezeBlackWhite(input.frames, input.thresholds),
    edgeGutter: summarizeEdgeGutter(input.frames, input.thresholds),
    temporal: summarizeTemporalSignals(input.frames, input.thresholds),
    audio: input.audio
      ? summarizeAudioSignals(input.audio, input.thresholds)
      : undefined,
  };
}

export interface TechnicalSignalThresholds {
  maxMedianCutIntervalSeconds?: number;
  minCutCount?: number;
  blackFramePixelRatio?: number;
  whiteFramePixelRatio?: number;
  blackLumaMax?: number;
  whiteLumaMin?: number;
  freezeDifferenceThreshold?: number;
  freezeMinRunFrames?: number;
  edgeArtifactRatio?: number;
  maxContentExtremeRatioForEdgeArtifact?: number;
  duplicateDifferenceThreshold?: number;
  duplicateMinRunFrames?: number;
  loudnessMinLUFS?: number;
  loudnessMaxLUFS?: number;
  maxClippingRatio?: number;
  truePeakMaxDBFS?: number;
}

export function summarizeSceneCadence(input: {
  durationSeconds: number;
  cutTimesSeconds: number[];
  maxMedianCutIntervalSeconds?: number;
  minCutCount?: number;
}): SceneCadenceSummary {
  const durationSeconds = Math.max(0, finiteOr(input.durationSeconds, 0));
  const maxMedianCutIntervalSeconds = finitePositiveOr(
    input.maxMedianCutIntervalSeconds,
    3,
  );
  const minCutCount = Math.max(0, Math.floor(finiteOr(input.minCutCount, 2)));
  const cutTimes = [...input.cutTimesSeconds]
    .filter(
      (time) => Number.isFinite(time) && time >= 0 && time <= durationSeconds,
    )
    .sort((a, b) => a - b);
  const intervalsSeconds = buildIntervals(durationSeconds, cutTimes);
  const medianCutIntervalSeconds = finiteOr(
    median(intervalsSeconds),
    durationSeconds,
  );
  const meanCutIntervalSeconds = finiteOr(
    mean(intervalsSeconds),
    durationSeconds,
  );
  const maxCutIntervalSeconds = Math.max(0, ...intervalsSeconds);
  const passed =
    cutTimes.length >= minCutCount &&
    medianCutIntervalSeconds <= maxMedianCutIntervalSeconds;

  return {
    passed,
    cutCount: cutTimes.length,
    intervalsSeconds: intervalsSeconds.map(round),
    medianCutIntervalSeconds: round(medianCutIntervalSeconds),
    meanCutIntervalSeconds: round(meanCutIntervalSeconds),
    maxCutIntervalSeconds: round(maxCutIntervalSeconds),
    maxMedianCutIntervalSeconds,
    minCutCount,
  };
}

export function summarizeFreezeBlackWhite(
  frames: TechnicalFrameMetrics[],
  thresholds: TechnicalSignalThresholds = {},
): FreezeBlackWhiteSummary {
  const blackFramePixelRatio = finitePositiveOr(
    thresholds.blackFramePixelRatio,
    DEFAULT_BLACK_FRAME_PIXEL_RATIO,
  );
  const whiteFramePixelRatio = finitePositiveOr(
    thresholds.whiteFramePixelRatio,
    DEFAULT_WHITE_FRAME_PIXEL_RATIO,
  );
  const blackLumaMax = finitePositiveOr(
    thresholds.blackLumaMax,
    DEFAULT_BLACK_LUMA_MAX,
  );
  const whiteLumaMin = finitePositiveOr(
    thresholds.whiteLumaMin,
    DEFAULT_WHITE_LUMA_MIN,
  );
  const freezeDifferenceThreshold = finitePositiveOr(
    thresholds.freezeDifferenceThreshold,
    DEFAULT_FREEZE_DIFFERENCE_THRESHOLD,
  );
  const freezeMinRunFrames = Math.max(
    1,
    Math.floor(
      finiteOr(thresholds.freezeMinRunFrames, DEFAULT_FREEZE_MIN_RUN_FRAMES),
    ),
  );

  let blackFrames = 0;
  let whiteFrames = 0;
  let freezeEvents = 0;
  let frozenComparisonFrames = 0;
  let currentFreezeRun = 0;
  let comparisonCount = 0;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const luma = normalizedLuma(frame);
    const blackPixelRatio = ratioOr(
      frame.blackPixelRatio,
      luma <= blackLumaMax ? 1 : 0,
    );
    const whitePixelRatio = ratioOr(
      frame.whitePixelRatio,
      luma >= whiteLumaMin ? 1 : 0,
    );

    if (blackPixelRatio >= blackFramePixelRatio || luma <= blackLumaMax)
      blackFrames += 1;
    if (whitePixelRatio >= whiteFramePixelRatio || luma >= whiteLumaMin)
      whiteFrames += 1;

    const diff = frameDifference(frames, index);
    if (diff === undefined) continue;
    comparisonCount += 1;
    if (diff <= freezeDifferenceThreshold) {
      currentFreezeRun += 1;
      continue;
    }
    if (currentFreezeRun >= freezeMinRunFrames) {
      freezeEvents += 1;
      frozenComparisonFrames += currentFreezeRun;
    }
    currentFreezeRun = 0;
  }

  if (currentFreezeRun >= freezeMinRunFrames) {
    freezeEvents += 1;
    frozenComparisonFrames += currentFreezeRun;
  }

  return {
    totalFrames: frames.length,
    comparisonCount,
    freezeEvents,
    freezeRatio: roundRatio(frozenComparisonFrames, comparisonCount),
    frozenComparisonFrames,
    blackFrames,
    blackRatio: roundRatio(blackFrames, frames.length),
    whiteFrames,
    whiteRatio: roundRatio(whiteFrames, frames.length),
    maxBlackPixelRatio: maxRatio(frames.map((frame) => frame.blackPixelRatio)),
    maxWhitePixelRatio: maxRatio(frames.map((frame) => frame.whitePixelRatio)),
  };
}

export function summarizeEdgeGutter(
  frames: TechnicalFrameMetrics[],
  thresholds: TechnicalSignalThresholds = {},
): EdgeGutterSummary {
  const edgeArtifactRatio = finitePositiveOr(
    thresholds.edgeArtifactRatio,
    DEFAULT_EDGE_ARTIFACT_RATIO,
  );
  const maxContentExtremeRatioForEdgeArtifact = finitePositiveOr(
    thresholds.maxContentExtremeRatioForEdgeArtifact,
    DEFAULT_MAX_CONTENT_EXTREME_RATIO_FOR_EDGE_ARTIFACT,
  );
  const flaggedFrames: EdgeGutterSummary["frames"] = [];
  let blackGutterFrames = 0;
  let whiteEdgeFrames = 0;

  for (const frame of frames) {
    const edgeBlackRatio = ratioOr(frame.edgeBlackRatio, 0);
    const edgeWhiteRatio = ratioOr(frame.edgeWhiteRatio, 0);
    const contentBlackRatio = ratioOr(frame.contentBlackRatio, 0);
    const contentWhiteRatio = ratioOr(frame.contentWhiteRatio, 0);

    if (
      edgeBlackRatio >= edgeArtifactRatio &&
      contentBlackRatio <= maxContentExtremeRatioForEdgeArtifact
    ) {
      blackGutterFrames += 1;
      flaggedFrames.push({
        index: frame.index,
        timestampSeconds: frame.timestampSeconds,
        code: "black-gutter",
        edgeRatio: round(edgeBlackRatio),
        contentExtremeRatio: round(contentBlackRatio),
      });
    }

    if (
      edgeWhiteRatio >= edgeArtifactRatio &&
      contentWhiteRatio <= maxContentExtremeRatioForEdgeArtifact
    ) {
      whiteEdgeFrames += 1;
      flaggedFrames.push({
        index: frame.index,
        timestampSeconds: frame.timestampSeconds,
        code: "white-edge",
        edgeRatio: round(edgeWhiteRatio),
        contentExtremeRatio: round(contentWhiteRatio),
      });
    }
  }

  return {
    totalFrames: frames.length,
    blackGutterFrames,
    blackGutterRatio: roundRatio(blackGutterFrames, frames.length),
    whiteEdgeFrames,
    whiteEdgeRatio: roundRatio(whiteEdgeFrames, frames.length),
    maxEdgeBlackRatio: maxRatio(frames.map((frame) => frame.edgeBlackRatio)),
    maxEdgeWhiteRatio: maxRatio(frames.map((frame) => frame.edgeWhiteRatio)),
    frames: flaggedFrames,
  };
}

export function summarizeTemporalSignals(
  frames: TechnicalFrameMetrics[],
  thresholds: TechnicalSignalThresholds = {},
): TemporalSignalSummary {
  const lumas = frames
    .map(normalizedLuma255)
    .filter((value) => Number.isFinite(value));
  const diffs = frameLumaDiffs(lumas);
  const meanDiff = mean(diffs);
  const variance = mean(diffs.map((diff) => (diff - meanDiff) ** 2));
  const duplicateDifferenceThreshold = finitePositiveOr(
    thresholds.duplicateDifferenceThreshold,
    DEFAULT_DUPLICATE_DIFFERENCE_THRESHOLD,
  );
  const duplicateMinRunFrames = Math.max(
    1,
    Math.floor(
      finiteOr(
        thresholds.duplicateMinRunFrames,
        DEFAULT_DUPLICATE_MIN_RUN_FRAMES,
      ),
    ),
  );
  const duplicateRuns = countLowDifferenceRuns(frames, {
    threshold: duplicateDifferenceThreshold,
    minRunFrames: duplicateMinRunFrames,
  });

  return {
    flicker: {
      score: round(clamp01(1 - finiteOr(meanDiff, 0) / 30)),
      variance: round(finiteOr(variance, 0)),
      meanDiff: round(finiteOr(meanDiff, 0)),
    },
    duplicateFrameRatio: roundRatio(
      duplicateRuns.comparisonFrames,
      duplicateRuns.comparisons,
    ),
    duplicateRunCount: duplicateRuns.runCount,
    duplicateComparisonFrames: duplicateRuns.comparisonFrames,
    framesAnalyzed: frames.length,
  };
}

export function summarizeAudioSignals(
  input: AudioMetricInput,
  thresholds: TechnicalSignalThresholds = {},
): AudioSignalSummary {
  const loudnessLUFS = finiteOr(
    input.loudnessLUFS,
    finiteOr(input.meanVolumeDb, -99),
  );
  const truePeakDBFS = finiteOr(
    input.truePeakDBFS,
    finiteOr(input.maxVolumeDb, -99),
  );
  const peakLevelDB = finiteOr(
    input.peakLevelDB,
    finiteOr(input.maxVolumeDb, truePeakDBFS),
  );
  const loudnessRange = finiteOr(input.loudnessRange, 0);
  const clippingRatio = clamp01(finiteOr(input.clippingRatio, 0));
  const snrDB = finiteOr(input.snrDB, 0);
  const loudnessMin = finiteOr(
    thresholds.loudnessMinLUFS,
    DEFAULT_LOUDNESS_MIN_LUFS,
  );
  const loudnessMax = finiteOr(
    thresholds.loudnessMaxLUFS,
    DEFAULT_LOUDNESS_MAX_LUFS,
  );
  const maxClippingRatio = finiteOr(
    thresholds.maxClippingRatio,
    DEFAULT_MAX_CLIPPING_RATIO,
  );
  const truePeakMax = finiteOr(
    thresholds.truePeakMaxDBFS,
    DEFAULT_TRUE_PEAK_MAX_DBFS,
  );

  return {
    loudnessLUFS: round(loudnessLUFS),
    truePeakDBFS: round(truePeakDBFS),
    loudnessRange: round(loudnessRange),
    clippingRatio: round(clippingRatio),
    peakLevelDB: round(peakLevelDB),
    snrDB: round(snrDB),
    nearSilent:
      loudnessLUFS <= CRITICAL_SILENCE_MAX_LOUDNESS_LUFS ||
      peakLevelDB <= CRITICAL_SILENCE_MAX_PEAK_LEVEL_DB,
    tooQuiet: loudnessLUFS < loudnessMin,
    tooLoud: loudnessLUFS > loudnessMax,
    clipped: clippingRatio > maxClippingRatio,
    truePeakExceeded: truePeakDBFS > truePeakMax,
  };
}

function buildIntervals(
  durationSeconds: number,
  cutTimesSeconds: number[],
): number[] {
  if (durationSeconds <= 0) return [];
  const intervals: number[] = [];
  let previous = 0;
  for (const cutTime of cutTimesSeconds) {
    if (cutTime > previous) intervals.push(cutTime - previous);
    previous = cutTime;
  }
  if (durationSeconds > previous) intervals.push(durationSeconds - previous);
  return intervals;
}

function countLowDifferenceRuns(
  frames: TechnicalFrameMetrics[],
  options: { threshold: number; minRunFrames: number },
): { runCount: number; comparisonFrames: number; comparisons: number } {
  let runCount = 0;
  let comparisonFrames = 0;
  let comparisons = 0;
  let currentRun = 0;

  for (let index = 0; index < frames.length; index += 1) {
    const diff = frameDifference(frames, index);
    if (diff === undefined) continue;
    comparisons += 1;
    if (diff <= options.threshold) {
      currentRun += 1;
      continue;
    }
    if (currentRun >= options.minRunFrames) {
      runCount += 1;
      comparisonFrames += currentRun;
    }
    currentRun = 0;
  }

  if (currentRun >= options.minRunFrames) {
    runCount += 1;
    comparisonFrames += currentRun;
  }

  return { runCount, comparisonFrames, comparisons };
}

function frameDifference(
  frames: TechnicalFrameMetrics[],
  index: number,
): number | undefined {
  const frame = frames[index];
  const motionScore = finiteOptional(frame.motionScoreFromPrevious);
  if (motionScore !== undefined) return motionScore;
  const difference = finiteOptional(frame.differenceFromPrevious);
  if (difference !== undefined) return difference;
  if (index === 0) return undefined;
  const previous = normalizedLuma(frames[index - 1]);
  const current = normalizedLuma(frame);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return undefined;
  return Math.abs(current - previous);
}

function frameLumaDiffs(lumas: number[]): number[] {
  const diffs: number[] = [];
  for (let index = 1; index < lumas.length; index += 1) {
    diffs.push(Math.abs(lumas[index] - lumas[index - 1]));
  }
  return diffs;
}

function normalizedLuma(frame: TechnicalFrameMetrics): number {
  const raw = finiteOptional(frame.averageLuma ?? frame.meanLuma);
  if (raw === undefined) return NaN;
  return raw > 1.5 ? clamp01(raw / 255) : clamp01(raw);
}

function normalizedLuma255(frame: TechnicalFrameMetrics): number {
  return normalizedLuma(frame) * 255;
}

function maxRatio(values: Array<number | undefined>): number {
  return round(Math.max(0, ...values.map((value) => ratioOr(value, 0))));
}

function ratioOr(value: number | undefined, fallback: number): number {
  return clamp01(finiteOr(value, fallback));
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finiteOptional(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function finitePositiveOr(value: number | undefined, fallback: number): number {
  const numeric = finiteOr(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator) : 0;
}

function round(value: number): number {
  return Number(finiteOr(value, 0).toFixed(4));
}
