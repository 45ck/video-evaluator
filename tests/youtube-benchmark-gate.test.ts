import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAggregateReport,
  evaluateBenchmarkGate,
  isNegativeControlFalsePositive,
  parseArgs,
  type BenchmarkCaseReport,
  type BenchmarkConfig,
  type BenchmarkEntry,
} from "../scripts/bench/youtube-diverse-benchmark.ts";

function report(overrides: Partial<BenchmarkCaseReport> = {}): BenchmarkCaseReport {
  return {
    status: "ok",
    id: "case-id",
    category: "sample",
    expectedFit: "high",
    query: "sample query",
    startSeconds: 0,
    clipSeconds: 75,
    appNames: [],
    views: [],
    interactionSegments: [],
    likelyFlow: [],
    likelyCapabilities: [],
    semanticPass: false,
    notes: [],
    ...overrides,
  };
}

function aggregate(reports: BenchmarkCaseReport[]) {
  const config: BenchmarkConfig = {
    manifestPath: "/tmp/manifest.json",
    outputRoot: "/tmp/output",
    frameCount: 8,
    clipSeconds: 75,
    changeThreshold: 0.08,
    minConfidence: 45,
    gateThresholds: {},
  };
  return buildAggregateReport(config, reports);
}

test("parseArgs leaves gate thresholds disabled by default", () => {
  const config = parseArgs([]);
  assert.deepEqual(config.gateThresholds, {});
});

test("parseArgs accepts benchmark gate threshold flags", () => {
  const config = parseArgs([
    "--min-operational-successes=3",
    "--max-negative-control-false-positives=0",
    "--min-gold-high-fit-semantic-passes=1",
  ]);

  assert.deepEqual(config.gateThresholds, {
    minOperationalSuccesses: 3,
    maxNegativeControlFalsePositives: 0,
    minGoldHighFitSemanticPasses: 1,
  });
});

test("parseArgs rejects invalid gate thresholds before benchmark work starts", () => {
  assert.throws(
    () => parseArgs(["--min-operational-successes=-1"]),
    /--min-operational-successes must be a non-negative integer/,
  );
});

test("isNegativeControlFalsePositive catches forbidden semantic output", () => {
  const entry: BenchmarkEntry = {
    id: "cooking",
    category: "negative",
    query: "omelette",
    expectedFit: "low",
    curationStatus: "negative-control",
    forbiddenSignals: ["appNames", "views", "capabilities"],
  };

  assert.equal(
    isNegativeControlFalsePositive(entry, report({ id: "cooking", appNames: ["Finder"] })),
    true,
  );
  assert.equal(isNegativeControlFalsePositive(entry, report({ id: "cooking" })), false);
});

test("evaluateBenchmarkGate passes when all configured thresholds are met", () => {
  const entries: BenchmarkEntry[] = [
    { id: "gold", category: "ui", query: "paper cut", expectedFit: "high", curationStatus: "gold" },
    {
      id: "negative",
      category: "negative",
      query: "cats",
      expectedFit: "low",
      curationStatus: "negative-control",
      forbiddenSignals: ["appNames", "views", "capabilities"],
    },
  ];
  const gate = evaluateBenchmarkGate(
    entries,
    aggregate([
      report({ id: "gold", expectedFit: "high", semanticPass: true }),
      report({ id: "negative", expectedFit: "low" }),
    ]),
    {
      minOperationalSuccesses: 2,
      maxNegativeControlFalsePositives: 0,
      minGoldHighFitSemanticPasses: 1,
    },
  );

  assert.equal(gate.enabled, true);
  assert.equal(gate.passed, true);
  assert.deepEqual(
    gate.checks.map((check) => [check.name, check.actual, check.threshold, check.passed]),
    [
      ["min-operational-successes", 2, 2, true],
      ["max-negative-control-false-positives", 0, 0, true],
      ["min-gold-high-fit-semantic-passes", 1, 1, true],
    ],
  );
});

test("evaluateBenchmarkGate fails individual unmet thresholds", () => {
  const entries: BenchmarkEntry[] = [
    { id: "gold", category: "ui", query: "paper cut", expectedFit: "high", curationStatus: "gold" },
    {
      id: "negative",
      category: "negative",
      query: "cats",
      expectedFit: "low",
      curationStatus: "negative-control",
      forbiddenSignals: ["appNames", "views", "capabilities"],
    },
  ];
  const gate = evaluateBenchmarkGate(
    entries,
    aggregate([
      report({ id: "gold", expectedFit: "high", semanticPass: false }),
      report({ id: "negative", expectedFit: "low", likelyCapabilities: ["file editing"] }),
      report({ id: "failed", status: "error", expectedFit: "high", error: "download failed" }),
    ]),
    {
      minOperationalSuccesses: 3,
      maxNegativeControlFalsePositives: 0,
      minGoldHighFitSemanticPasses: 1,
    },
  );

  assert.equal(gate.passed, false);
  assert.deepEqual(
    gate.checks.map((check) => [check.name, check.actual, check.threshold, check.passed]),
    [
      ["min-operational-successes", 2, 3, false],
      ["max-negative-control-false-positives", 1, 0, false],
      ["min-gold-high-fit-semantic-passes", 0, 1, false],
    ],
  );
});
