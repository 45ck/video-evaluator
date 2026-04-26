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
        frames: [
          {
            index: 1,
            timestampSeconds: 0,
            lines: [
              { text: "Tech Helper", confidence: 90, region: "top" },
              { text: "How can I help you today?", confidence: 89, region: "middle" },
              { text: "Ask me anything about Macquarie College technology", confidence: 88, region: "middle" },
            ],
          },
          {
            index: 2,
            timestampSeconds: 10,
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
            lines: [
              { text: "Tech Helper", confidence: 91, region: "top" },
              { text: "Win Network Guide", confidence: 84, region: "middle" },
              { text: "Message MC Tech Helper", confidence: 83, region: "bottom" },
            ],
          },
          {
            index: 4,
            timestampSeconds: 30,
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
  assert.ok(written.appNames.some((name: string) => /documentation/i.test(name)));
  assert.ok(written.views.includes("Win Network Guide"));
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
  assert.deepEqual(written.likelyFlow, [
    "frame 1 -> 2: screen-change - major screen change",
    "frame 2 -> 3: state-change - content/state changed on the same screen",
  ]);
});
