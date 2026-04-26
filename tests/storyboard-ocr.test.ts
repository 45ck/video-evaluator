import test from "node:test";
import assert from "node:assert/strict";
import { assessStoryboardOcrFrameQuality, type StoryboardOcrLine } from "../src/core/storyboard-ocr.js";

function line(
  text: string,
  confidence: number,
  region: "top" | "middle" | "bottom",
): StoryboardOcrLine {
  return { text, confidence, region };
}

test("assessStoryboardOcrFrameQuality keeps short UI labels as semantic evidence", () => {
  const result = assessStoryboardOcrFrameQuality([
    line("MC ICT Documentation", 94, "top"),
    line("Accessing Google Workspace", 92, "top"),
    line("Search", 90, "top"),
    line("Sign in", 88, "middle"),
  ]);

  assert.equal(result.quality.status, "usable");
  assert.equal(result.semanticLines.length, 4);
  assert.equal(result.quality.topAnchorCount, 3);
  assert.equal(result.quality.bottomSentenceShare, 0);
});

test("assessStoryboardOcrFrameQuality rejects subtitle-dominated frames", () => {
  const result = assessStoryboardOcrFrameQuality([
    line("Here's how to connect to WiFi on your Windows device.", 90, "bottom"),
    line("Select the network and enter the password to continue.", 88, "bottom"),
    line("If you have any issues, feel free to ask for help.", 87, "bottom"),
  ]);

  assert.equal(result.quality.status, "reject");
  assert.equal(result.semanticLines.length, 0);
  assert.ok(result.quality.reasons.includes("no-usable-ui-lines") || result.quality.reasons.includes("subtitle-dominated"));
});

test("assessStoryboardOcrFrameQuality marks thin OCR frames as weak instead of usable", () => {
  const result = assessStoryboardOcrFrameQuality([
    line("Settings", 63, "top"),
  ]);

  assert.equal(result.quality.status, "weak");
  assert.ok(result.quality.reasons.includes("thin-ui-evidence"));
});
