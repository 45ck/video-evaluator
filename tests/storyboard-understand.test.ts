import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { understandStoryboard } from "../src/core/storyboard-understand.js";

test("understandStoryboard extracts app names, views, capabilities, and transition-aware flow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-understand-"));
  const storyboardDir = join(dir, "storyboard");
  await mkdir(storyboardDir, { recursive: true });
  await writeFile(
    join(dir, "storyboard.ocr.json"),
    JSON.stringify(
      {
        storyboardDir,
        videoPath: "/tmp/rag-chat.mp4",
        samplingMode: "hybrid",
        detectedChangeCount: 6,
        frames: [
          {
            index: 1,
            timestampSeconds: 0,
            samplingReason: "uniform",
            nearestChangeDistanceSeconds: 2.5,
            lines: [
              { text: "Tech Helper", confidence: 90, region: "top" },
              { text: "How can I help you today?", confidence: 89, region: "middle" },
              { text: "Ask me anything about Macquarie College technology", confidence: 88, region: "middle" },
            ],
          },
          {
            index: 2,
            timestampSeconds: 10,
            samplingReason: "change-peak",
            nearestChangeDistanceSeconds: 0.1,
            lines: [
              { text: "Tech Helper", confidence: 92, region: "top" },
              { text: "Win Network Guide", confidence: 85, region: "middle" },
              { text: "Step 1: Open WiFi Settings", confidence: 84, region: "middle" },
              { text: "8 sources", confidence: 80, region: "bottom" },
            ],
          },
          {
            index: 3,
            timestampSeconds: 20,
            samplingReason: "change-peak",
            nearestChangeDistanceSeconds: 0.2,
            lines: [
              { text: "Tech Helper", confidence: 91, region: "top" },
              { text: "Win Network Guide", confidence: 84, region: "middle" },
              { text: "Message MC Tech Helper", confidence: 83, region: "bottom" },
            ],
          },
          {
            index: 4,
            timestampSeconds: 30,
            samplingReason: "coverage-fill",
            nearestChangeDistanceSeconds: 1.7,
            lines: [
              { text: "MC ICT Documentation", confidence: 93, region: "top" },
              { text: "Getting Started", confidence: 87, region: "middle" },
              { text: "Browse documentation", confidence: 86, region: "middle" },
              { text: "Signed in as Demo User", confidence: 85, region: "middle" },
              { text: "Roles: superadmin", confidence: 85, region: "middle" },
            ],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    join(storyboardDir, "storyboard.transitions.json"),
    JSON.stringify(
      {
        transitions: [
          {
            fromFrameIndex: 1,
            toFrameIndex: 2,
            inferredTransition: "major screen change",
            confidence: 0.78,
            transitionKind: "screen-change",
          },
          {
            fromFrameIndex: 2,
            toFrameIndex: 3,
            inferredTransition: "content/state changed on the same screen",
            confidence: 0.66,
            transitionKind: "state-change",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await understandStoryboard({
    ocrPath: join(dir, "storyboard.ocr.json"),
  });
  const written = JSON.parse(await readFile(result.outputPath, "utf8"));

  assert.ok(written.appNames.includes("Tech Helper"));
  assert.ok(written.views.includes("Win Network Guide"));
  assert.equal(written.sampling.mode, "hybrid");
  assert.equal(written.sampling.detectedChangeCount, 6);
  assert.equal(written.sampling.frameReasonCounts["change-peak"], 2);
  assert.equal(written.sampling.frameReasonCounts.uniform, 1);
  assert.equal(written.sampling.frameReasonCounts["coverage-fill"], 1);
  assert.ok(written.sampling.notes.some((note: string) => /Hybrid sampling used 2 change-biased frames/.test(note)));
  assert.ok(
    written.likelyCapabilities.some((claim: { claim: string }) =>
      claim.claim.includes("chat-style IT help or guided support"),
    ),
  );
  assert.ok(
    written.likelyCapabilities.some((claim: { claim: string }) =>
      claim.claim.includes("step-by-step guided instructions"),
    ),
  );
  assert.ok(
    written.likelyCapabilities.some((claim: { claim: string }) =>
      claim.claim.includes("authenticated or admin-only surfaces"),
    ),
  );
  assert.ok(
    written.likelyCapabilities.some((claim: { claim: string }) =>
      claim.claim.includes("browsable documentation or onboarding content"),
    ),
  );
  assert.equal(written.interactionSegments.length, 1);
  assert.match(written.interactionSegments[0].summary, /same screen/i);
  assert.deepEqual(written.likelyFlow, [
    "frame 1 -> 2: screen-change - major screen change",
    "frame 2 -> 3: state-change - content/state changed on the same screen",
  ]);
});

test("understandStoryboard favors persistent shell labels and specific page headlines for docs-style videos", async () => {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-understand-docs-"));
  const storyboardDir = join(dir, "storyboard");
  await mkdir(storyboardDir, { recursive: true });
  await writeFile(
    join(dir, "storyboard.ocr.json"),
    JSON.stringify(
      {
        storyboardDir,
        videoPath: "/tmp/docs.mp4",
        samplingMode: "hybrid",
        detectedChangeCount: 8,
        frames: [
          {
            index: 1,
            timestampSeconds: 0,
            samplingReason: "change-peak",
            nearestChangeDistanceSeconds: 0,
            lines: [
              { text: "MC ICT Documentation", confidence: 96, region: "top" },
              { text: "Getting Started", confidence: 90, region: "middle" },
              { text: "Read the basics", confidence: 88, region: "middle" },
            ],
          },
          {
            index: 2,
            timestampSeconds: 10,
            samplingReason: "change-peak",
            nearestChangeDistanceSeconds: 0,
            lines: [
              { text: "MC ICT Documentation", confidence: 96, region: "top" },
              { text: "Logging In to SEQTA Teach", confidence: 92, region: "top" },
              { text: "Option 2: via MC Portal", confidence: 90, region: "top" },
              { text: "How to log in to SEQTA Teach", confidence: 90, region: "middle" },
            ],
          },
          {
            index: 3,
            timestampSeconds: 20,
            samplingReason: "change-peak",
            nearestChangeDistanceSeconds: 0,
            lines: [
              { text: "MC ICT Documentation", confidence: 95, region: "top" },
              { text: "Accessing Google Workspace", confidence: 91, region: "top" },
              { text: "Your MC Google account", confidence: 85, region: "middle" },
            ],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await understandStoryboard({
    ocrPath: join(dir, "storyboard.ocr.json"),
  });
  const written = JSON.parse(await readFile(result.outputPath, "utf8"));

  assert.ok(written.appNames.includes("MC ICT Documentation"));
  assert.ok(!written.appNames.includes("MC Portal"));
  assert.ok(written.views.includes("Logging In To SEQTA Teach"));
  assert.ok(written.views.includes("Accessing Google Workspace"));
  assert.ok(!written.views.includes("Getting Started"));
  assert.deepEqual(written.interactionSegments, []);
});

test("understandStoryboard flags narration-dominated OCR from frame text alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-understand-narration-"));
  const storyboardDir = join(dir, "storyboard");
  await mkdir(storyboardDir, { recursive: true });
  await writeFile(
    join(dir, "storyboard.ocr.json"),
    JSON.stringify(
      {
        storyboardDir,
        videoPath: "/tmp/narration.mp4",
        frames: [
          {
            index: 1,
            timestampSeconds: 0,
            lines: [
              { text: "How can I help you today?", confidence: 92, region: "middle" },
              { text: "Ask me anything about school technology", confidence: 91, region: "middle" },
              { text: "Here's how to connect to WiFi on your Windows device.", confidence: 95, region: "bottom" },
            ],
          },
          {
            index: 2,
            timestampSeconds: 8,
            lines: [
              { text: "Step 1: Open WiFi Settings", confidence: 94, region: "top" },
              { text: "Click the WiFi icon in the taskbar.", confidence: 93, region: "middle" },
              { text: "Select the network and enter the password.", confidence: 92, region: "bottom" },
            ],
          },
          {
            index: 3,
            timestampSeconds: 16,
            lines: [
              { text: "You're all set! If you have any issues, feel free to ask for help.", confidence: 94, region: "bottom" },
              { text: "Great question!", confidence: 90, region: "middle" },
              { text: "Step 2: Continue to the next screen", confidence: 89, region: "bottom" },
            ],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await understandStoryboard({
    ocrPath: join(dir, "storyboard.ocr.json"),
  });
  const written = JSON.parse(await readFile(result.outputPath, "utf8"));

  assert.equal(written.textDominance.likelyNarrationDominated, true);
  assert.ok(written.textDominance.narrationLikeLineShare >= 0.4);
  assert.ok(written.textDominance.narrationLikeFrameShare >= 0.5);
  assert.match(written.textDominance.notes[0], /Narration-like OCR accounts for/i);
});

test("understandStoryboard keeps UI-led OCR below the narration-dominated threshold", async () => {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-understand-ui-led-"));
  const storyboardDir = join(dir, "storyboard");
  await mkdir(storyboardDir, { recursive: true });
  await writeFile(
    join(dir, "storyboard.ocr.json"),
    JSON.stringify(
      {
        storyboardDir,
        videoPath: "/tmp/ui-led.mp4",
        frames: [
          {
            index: 1,
            timestampSeconds: 0,
            lines: [
              { text: "ICT Visit Tracker", confidence: 96, region: "top" },
              { text: "Dashboard", confidence: 95, region: "top" },
              { text: "ICT Queue", confidence: 94, region: "middle" },
              { text: "Sign out", confidence: 93, region: "top" },
            ],
          },
          {
            index: 2,
            timestampSeconds: 8,
            lines: [
              { text: "Manage incoming students", confidence: 95, region: "middle" },
              { text: "Returned Today", confidence: 94, region: "middle" },
              { text: "Refresh", confidence: 92, region: "bottom" },
            ],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await understandStoryboard({
    ocrPath: join(dir, "storyboard.ocr.json"),
  });
  const written = JSON.parse(await readFile(result.outputPath, "utf8"));

  assert.equal(written.textDominance.likelyNarrationDominated, false);
  assert.ok(written.textDominance.narrationLikeLineShare < 0.4);
  assert.ok(written.textDominance.notes.some((note: string) => /mostly short UI labels/i.test(note)));
});
