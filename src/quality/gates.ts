import type { MediaProbeArtifact } from "../probe/media.js";

export const QUALITY_GATES_SCHEMA = "quality.gates.v1" as const;

export type QualityGateStatus = "pass" | "warn" | "fail";
export type QualityGateSeverity = "error" | "warn";
export type QualityGateValue = string | number | boolean | null | string[] | number[];

export interface RenderQualityGatePolicy {
  expectedDimensions?: {
    width: number;
    height: number;
  };
  allowedContainers?: string[];
  allowedVideoCodecs?: string[];
  allowedAudioCodecs?: string[];
  allowedPixelFormats?: string[];
  requireAudio?: boolean;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  expectedDurationSeconds?: number;
  durationToleranceSeconds?: number;
  audioVideoDurationToleranceSeconds?: number;
  minFps?: number;
  maxFps?: number;
  expectedFps?: number;
  fpsTolerance?: number;
  minFileSizeBytes?: number;
  maxFileSizeBytes?: number;
}

export interface QualityGateCheck {
  id: string;
  label: string;
  status: QualityGateStatus;
  severity: QualityGateSeverity;
  actual: QualityGateValue;
  expected: QualityGateValue;
  message: string;
}

export interface QualityGatesArtifact {
  schema: typeof QUALITY_GATES_SCHEMA;
  createdAt: string;
  mediaProbeSchema: MediaProbeArtifact["schema"];
  status: QualityGateStatus;
  checks: QualityGateCheck[];
}

export interface EvaluateRenderQualityGatesOptions {
  now?: () => Date;
}

export function evaluateRenderQualityGates(
  probe: MediaProbeArtifact,
  policy: RenderQualityGatePolicy = {},
  options: EvaluateRenderQualityGatesOptions = {},
): QualityGatesArtifact {
  const checks: QualityGateCheck[] = [];
  const video = probe.video;
  const audio = probe.audio;

  addCheck(
    checks,
    "video-stream-present",
    "Video stream present",
    probe.hasVideo && video !== null,
    probe.hasVideo,
    true,
    "The file has a video stream.",
    "The file is missing a video stream.",
  );

  addCheck(
    checks,
    "duration-valid",
    "Duration valid",
    typeof probe.durationSeconds === "number" && probe.durationSeconds > 0,
    probe.durationSeconds,
    durationExpectation(policy),
    "The media duration is valid.",
    "The media duration is missing or invalid.",
  );
  applyNumericRange(checks, "duration-valid", probe.durationSeconds, {
    min: policy.minDurationSeconds,
    max: policy.maxDurationSeconds,
    expected: policy.expectedDurationSeconds,
    tolerance: policy.durationToleranceSeconds,
    unit: "s",
  });

  addCheck(
    checks,
    "file-size-valid",
    "File size valid",
    typeof probe.sizeBytes === "number" && probe.sizeBytes > 0,
    probe.sizeBytes,
    fileSizeExpectation(policy),
    "The media file size is valid.",
    "The media file size is missing or invalid.",
  );
  applyNumericRange(checks, "file-size-valid", probe.sizeBytes, {
    min: policy.minFileSizeBytes,
    max: policy.maxFileSizeBytes,
    unit: "bytes",
  });

  const width = video?.width ?? null;
  const height = video?.height ?? null;
  const dimensionsValid = width !== null && height !== null;
  const dimensionsMatch =
    dimensionsValid &&
    (!policy.expectedDimensions ||
      (width === policy.expectedDimensions.width && height === policy.expectedDimensions.height));
  addCheck(
    checks,
    "dimensions",
    "Dimensions",
    Boolean(dimensionsMatch),
    dimensionsValid ? `${width}x${height}` : null,
    policy.expectedDimensions
      ? `${policy.expectedDimensions.width}x${policy.expectedDimensions.height}`
      : "positive width and height",
    policy.expectedDimensions ? "The video dimensions match the expected render size." : "The video dimensions are valid.",
    dimensionsValid ? "The video dimensions do not match the expected render size." : "The video dimensions are missing or invalid.",
  );

  addStringMembershipCheck(checks, {
    id: "container",
    label: "Container",
    actual: probe.container.formatName,
    allowed: policy.allowedContainers,
    missingMessage: "The media container is missing.",
    allowedMessage: "The media container is supported.",
    disallowedMessage: "The media container is not supported.",
    presentMessage: "The media container is present.",
    matches: containerMatches,
  });

  addStringMembershipCheck(checks, {
    id: "video-codec",
    label: "Video codec",
    actual: video?.codecName ?? null,
    allowed: policy.allowedVideoCodecs,
    missingMessage: "The video codec is missing.",
    allowedMessage: "The video codec is supported.",
    disallowedMessage: "The video codec is not supported.",
    presentMessage: "The video codec is present.",
  });

  addStringMembershipCheck(checks, {
    id: "pixel-format",
    label: "Pixel format",
    actual: video?.pixelFormat ?? null,
    allowed: policy.allowedPixelFormats,
    missingMessage: "The video pixel format is missing.",
    allowedMessage: "The video pixel format is supported.",
    disallowedMessage: "The video pixel format is not supported.",
    presentMessage: "The video pixel format is present.",
  });

  addCheck(
    checks,
    "fps",
    "Frame rate",
    typeof video?.fps === "number" && video.fps > 0,
    video?.fps ?? null,
    fpsExpectation(policy),
    "The video frame rate is valid.",
    "The video frame rate is missing or invalid.",
  );
  applyNumericRange(checks, "fps", video?.fps ?? null, {
    min: policy.minFps,
    max: policy.maxFps,
    expected: policy.expectedFps,
    tolerance: policy.fpsTolerance,
    unit: "fps",
  });

  const requireAudio = policy.requireAudio === true;
  addCheck(
    checks,
    "audio-presence",
    "Audio presence",
    requireAudio ? probe.hasAudio && audio !== null : true,
    probe.hasAudio,
    requireAudio ? true : "not required",
    requireAudio ? "The file has a required audio stream." : "Audio is not required by this policy.",
    "The file is missing a required audio stream.",
  );

  if (requireAudio || audio) {
    addStringMembershipCheck(checks, {
      id: "audio-codec",
      label: "Audio codec",
      actual: audio?.codecName ?? null,
      allowed: policy.allowedAudioCodecs,
      missingMessage: "The audio codec is missing.",
      allowedMessage: "The audio codec is supported.",
      disallowedMessage: "The audio codec is not supported.",
      presentMessage: "The audio codec is present.",
    });
  }

  if (typeof policy.audioVideoDurationToleranceSeconds === "number") {
    const delta = durationDelta(video?.durationSeconds ?? probe.durationSeconds, audio?.durationSeconds ?? null);
    addCheck(
      checks,
      "audio-video-duration-match",
      "Audio/video duration match",
      delta !== null && delta <= policy.audioVideoDurationToleranceSeconds,
      delta,
      `<= ${policy.audioVideoDurationToleranceSeconds}s`,
      "Audio and video durations are within tolerance.",
      delta === null
        ? "Audio/video duration comparison could not be computed."
        : "Audio and video durations differ more than allowed.",
    );
  }

  return {
    schema: QUALITY_GATES_SCHEMA,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    mediaProbeSchema: probe.schema,
    status: collapseStatus(checks),
    checks,
  };
}

function addCheck(
  checks: QualityGateCheck[],
  id: string,
  label: string,
  passed: boolean,
  actual: QualityGateValue,
  expected: QualityGateValue,
  passMessage: string,
  failMessage: string,
  severity: QualityGateSeverity = "error",
): void {
  checks.push({
    id,
    label,
    status: passed ? "pass" : severity === "warn" ? "warn" : "fail",
    severity,
    actual,
    expected,
    message: passed ? passMessage : failMessage,
  });
}

function addStringMembershipCheck(
  checks: QualityGateCheck[],
  input: {
    id: string;
    label: string;
    actual: string | null;
    allowed?: string[];
    missingMessage: string;
    allowedMessage: string;
    disallowedMessage: string;
    presentMessage: string;
    matches?: (actual: string, expected: string) => boolean;
  },
): void {
  const allowed = input.allowed?.filter((value) => value.trim() !== "");
  const actual = input.actual;
  const hasValue = actual !== null && actual.trim() !== "";
  const matches = input.matches ?? ((actual, expected) => actual.toLowerCase() === expected.toLowerCase());
  const isAllowed = !allowed || allowed.length === 0 || (actual !== null && allowed.some((value) => matches(actual, value)));
  addCheck(
    checks,
    input.id,
    input.label,
    hasValue && isAllowed,
    input.actual,
    allowed && allowed.length > 0 ? allowed : "present",
    allowed && allowed.length > 0 ? input.allowedMessage : input.presentMessage,
    hasValue ? input.disallowedMessage : input.missingMessage,
  );
}

function applyNumericRange(
  checks: QualityGateCheck[],
  id: string,
  actual: number | null | undefined,
  policy: {
    min?: number;
    max?: number;
    expected?: number;
    tolerance?: number;
    unit: string;
  },
): void {
  const check = checks.find((candidate) => candidate.id === id);
  if (!check || check.status !== "pass" || typeof actual !== "number") return;

  const failures: string[] = [];
  if (typeof policy.min === "number" && actual < policy.min) failures.push(`below ${policy.min}${policy.unit}`);
  if (typeof policy.max === "number" && actual > policy.max) failures.push(`above ${policy.max}${policy.unit}`);
  if (typeof policy.expected === "number") {
    const tolerance = policy.tolerance ?? 0;
    if (Math.abs(actual - policy.expected) > tolerance) {
      failures.push(`outside ${policy.expected}${policy.unit} +/- ${tolerance}${policy.unit}`);
    }
  }

  if (failures.length > 0) {
    check.status = "fail";
    check.message = `The value is ${failures.join(" and ")}.`;
  }
}

function collapseStatus(checks: QualityGateCheck[]): QualityGateStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

function containerMatches(actual: string, expected: string): boolean {
  const normalizedExpected = expected.toLowerCase();
  return actual
    .toLowerCase()
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === normalizedExpected);
}

function durationDelta(left: number | null | undefined, right: number | null | undefined): number | null {
  if (typeof left !== "number" || typeof right !== "number") return null;
  return Number(Math.abs(left - right).toFixed(6));
}

function durationExpectation(policy: RenderQualityGatePolicy): QualityGateValue {
  if (typeof policy.expectedDurationSeconds === "number") {
    return `${policy.expectedDurationSeconds}s +/- ${policy.durationToleranceSeconds ?? 0}s`;
  }
  const parts = [];
  if (typeof policy.minDurationSeconds === "number") parts.push(`>= ${policy.minDurationSeconds}s`);
  if (typeof policy.maxDurationSeconds === "number") parts.push(`<= ${policy.maxDurationSeconds}s`);
  return parts.length > 0 ? parts : "positive duration";
}

function fileSizeExpectation(policy: RenderQualityGatePolicy): QualityGateValue {
  const parts = [];
  if (typeof policy.minFileSizeBytes === "number") parts.push(`>= ${policy.minFileSizeBytes} bytes`);
  if (typeof policy.maxFileSizeBytes === "number") parts.push(`<= ${policy.maxFileSizeBytes} bytes`);
  return parts.length > 0 ? parts : "positive file size";
}

function fpsExpectation(policy: RenderQualityGatePolicy): QualityGateValue {
  if (typeof policy.expectedFps === "number") {
    return `${policy.expectedFps}fps +/- ${policy.fpsTolerance ?? 0}fps`;
  }
  const parts = [];
  if (typeof policy.minFps === "number") parts.push(`>= ${policy.minFps}fps`);
  if (typeof policy.maxFps === "number") parts.push(`<= ${policy.maxFps}fps`);
  return parts.length > 0 ? parts : "positive fps";
}
