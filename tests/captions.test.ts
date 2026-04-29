import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCaptionSidecar,
  reviewCaptionOcr,
  reviewCaptionQuality,
  reviewCaptionSync,
  type CaptionOcrBox,
} from "../src/captions/index.js";

const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
Open the settings panel

00:00:03.200 --> 00:00:05.000
Then choose privacy
`;

test("parseCaptionSidecar normalizes WebVTT, SRT, and JSON caption sidecars", () => {
  const webvtt = parseCaptionSidecar(vtt);
  assert.equal(webvtt.length, 2);
  assert.equal(webvtt[0].startSeconds, 1);
  assert.equal(webvtt[0].text, "Open the settings panel");

  const srt = parseCaptionSidecar(`1
00:00:00,500 --> 00:00:01,250
Short line
`);
  assert.equal(srt.length, 1);
  assert.equal(srt[0].startSeconds, 0.5);
  assert.equal(srt[0].endSeconds, 1.25);

  const json = parseCaptionSidecar({
    cues: [{ id: "caption-a", start: 2, end: 4, text: "JSON caption" }],
  });
  assert.equal(json.length, 1);
  assert.equal(json[0].id, "caption-a");
});

test("reviewCaptionQuality reports coverage and readability issues", () => {
  const review = reviewCaptionQuality(
    {
      cues: [
        { id: "fast", startSeconds: 0, endSeconds: 0.5, text: "This caption is too dense to read comfortably" },
        { id: "ok", startSeconds: 1, endSeconds: 3, text: "Readable caption" },
      ],
    },
    {
      videoDurationSeconds: 4,
      maxCharsPerSecond: 25,
      maxLineLength: 30,
      createdAt: "2026-04-29T00:00:00.000Z",
    },
  );

  assert.equal(review.schemaVersion, "caption.quality.v1");
  assert.equal(review.metrics.cueCount, 2);
  assert.equal(review.metrics.coverageRatio, 0.625);
  assert.ok(review.metrics.maxCharsPerSecond > 25);
  assert.ok(review.issues.some((issue) => issue.code === "short-duration"));
  assert.ok(review.issues.some((issue) => issue.code === "high-cps"));
});

test("reviewCaptionOcr uses provided boxes and configurable regions without running OCR", () => {
  const boxes: CaptionOcrBox[] = [
    {
      id: "box-1",
      timestampSeconds: 2,
      text: "Open the settings panel",
      confidence: 91,
      box: { x: 120, y: 760, width: 600, height: 80 },
      imageWidth: 1080,
      imageHeight: 1920,
    },
    {
      id: "box-2",
      timestampSeconds: 4.1,
      text: "Then choose privacy",
      confidence: 88,
      box: { x: 100, y: 760, width: 580, height: 80 },
      imageWidth: 1080,
      imageHeight: 1920,
    },
    {
      id: "top-ui",
      timestampSeconds: 2,
      text: "Dashboard",
      confidence: 97,
      box: { x: 50, y: 30, width: 200, height: 50 },
      imageWidth: 1080,
      imageHeight: 1920,
    },
  ];

  const review = reviewCaptionOcr(vtt, boxes, {
    regions: [{ name: "caption-band", box: { x: 0, y: 0.35, width: 1, height: 0.2 } }],
    targetRegions: ["caption-band"],
    createdAt: "2026-04-29T00:00:00.000Z",
  });

  assert.equal(review.schemaVersion, "caption.ocr.v1");
  assert.equal(review.status, "ready");
  assert.equal(review.metrics.providedOcrBoxCount, 3);
  assert.equal(review.metrics.regionOcrBoxCount, 2);
  assert.equal(review.metrics.matchedCueCount, 2);
  assert.equal(review.metrics.textCoverageRatio, 1);
  assert.equal(review.metrics.averageConfidence, 89.5);
});

test("reviewCaptionOcr and reviewCaptionSync are unavailable when OCR boxes are absent", () => {
  const ocr = reviewCaptionOcr(vtt, undefined, { createdAt: "2026-04-29T00:00:00.000Z" });
  const sync = reviewCaptionSync(vtt, [], { createdAt: "2026-04-29T00:00:00.000Z" });

  assert.equal(ocr.status, "unavailable");
  assert.equal(ocr.issues[0].code, "no-ocr-boxes");
  assert.equal(sync.status, "unavailable");
  assert.equal(sync.matches.length, 2);
  assert.equal(sync.issues[0].code, "no-ocr-boxes");
});

test("reviewCaptionSync reports drift, coverage, and missing OCR matches", () => {
  const review = reviewCaptionSync(
    vtt,
    [
      {
        id: "late",
        startSeconds: 1.6,
        endSeconds: 3.6,
        text: "Open settings panel",
        confidence: 90,
        region: "bottom",
      },
    ],
    {
      targetRegions: ["bottom"],
      maxSyncDriftSeconds: 0.35,
      minTextSimilarity: 0.4,
      createdAt: "2026-04-29T00:00:00.000Z",
    },
  );

  assert.equal(review.schemaVersion, "caption.sync.v1");
  assert.equal(review.status, "ready");
  assert.equal(review.metrics.matchedCueCount, 1);
  assert.equal(review.metrics.coverageRatio, 0.5);
  assert.equal(review.metrics.averageAbsDriftSeconds, 0.6);
  assert.equal(review.metrics.withinToleranceRatio, 0);
  assert.ok(review.issues.some((issue) => issue.code === "caption-drift"));
  assert.ok(review.issues.some((issue) => issue.code === "missing-ocr-match"));
});
