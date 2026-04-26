import { intakeBundle } from "../core/bundle.js";
import {
  CompareBundlesRequestSchema,
  type CompareBundlesRequest,
} from "../core/schemas.js";

function diffStatuses(
  left: Array<{ name: string; status: string }>,
  right: Array<{ name: string; status: string }>,
) {
  const leftMap = new Map(left.map((entry) => [entry.name, entry.status]));
  const rightMap = new Map(right.map((entry) => [entry.name, entry.status]));
  const names = new Set([...leftMap.keys(), ...rightMap.keys()]);
  return [...names].map((name) => ({
    name,
    left: leftMap.get(name) ?? "missing",
    right: rightMap.get(name) ?? "missing",
  }));
}

export async function compareBundles(input: CompareBundlesRequest) {
  const left = await intakeBundle(input.left);
  const right = await intakeBundle(input.right);
  return {
    left,
    right,
    overallChanged: left.overallStatus !== right.overallStatus,
    reportDiffs: diffStatuses(left.reportStatuses, right.reportStatuses),
    videoDelta: {
      leftDurationSeconds: left.videoProbe?.durationSeconds ?? null,
      rightDurationSeconds: right.videoProbe?.durationSeconds ?? null,
      leftSizeBytes: left.videoProbe?.sizeBytes ?? null,
      rightSizeBytes: right.videoProbe?.sizeBytes ?? null,
    },
  };
}

export { CompareBundlesRequestSchema };
