import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyStoryboardTransition,
  type TransitionOcrFrame,
} from "../src/core/storyboard-transitions.js";

function line(
  text: string,
  region: "top" | "middle" | "bottom",
  centerY: number,
  width = 200,
): TransitionOcrFrame["lines"][number] {
  return {
    text,
    confidence: 95,
    region,
    bbox: {
      x0: 100,
      y0: centerY - 10,
      x1: 100 + width,
      y1: centerY + 10,
      width,
      height: 20,
      centerX: 100 + width / 2,
      centerY,
    },
  };
}

function frame(
  index: number,
  lines: TransitionOcrFrame["lines"],
  imageHeight = 1000,
): TransitionOcrFrame {
  return {
    index,
    timestampSeconds: index * 10,
    imagePath: `/tmp/frame-${index}.jpg`,
    samplingReason: "uniform",
    imageWidth: 1600,
    imageHeight,
    lines,
  };
}

test("classifies a scroll change when top anchors persist and shared lines shift vertically", () => {
  const previous = frame(1, [
    line("Dashboard", "top", 60),
    line("Projects", "middle", 420),
    line("Writing", "middle", 520),
    line("About", "middle", 620),
  ]);
  const current = frame(2, [
    line("Dashboard", "top", 60),
    line("Projects", "middle", 320),
    line("Writing", "middle", 420),
    line("About", "middle", 520),
  ]);

  const transition = classifyStoryboardTransition(previous, current, {
    visualDiffPercent: 0.01,
    threshold: 0.02,
  });

  assert.equal(transition.transitionKind, "scroll-change");
  assert.match(transition.inferredTransition, /scrolled within the same screen/i);
  assert.ok(transition.sharedLineCount >= 3);
});

test("classifies a dialog change when top anchors persist and new middle content appears", () => {
  const previous = frame(1, [
    line("Dashboard", "top", 60),
    line("Library", "top", 90),
    line("Recent files", "middle", 420),
    line("Shared docs", "middle", 520),
  ]);
  const current = frame(2, [
    line("Dashboard", "top", 60),
    line("Library", "top", 90),
    line("Recent files", "middle", 420),
    line("Shared docs", "middle", 520),
    line("Confirm delete", "middle", 470),
    line("This action cannot be undone", "middle", 540, 360),
  ]);

  const transition = classifyStoryboardTransition(previous, current, {
    visualDiffPercent: 0.03,
    threshold: 0.02,
  });

  assert.equal(transition.transitionKind, "dialog-change");
  assert.match(transition.inferredTransition, /focused panel\/dialog/i);
});

test("classifies a same-screen state change when shell persists but content changes", () => {
  const previous = frame(1, [
    line("Dashboard", "top", 60),
    line("Orders", "top", 90),
    line("Status: Draft", "middle", 420),
    line("Assigned to Calvin", "middle", 520),
  ]);
  const current = frame(2, [
    line("Dashboard", "top", 60),
    line("Orders", "top", 90),
    line("Status: Sent", "middle", 420),
    line("Assigned to Calvin", "middle", 520),
  ]);

  const transition = classifyStoryboardTransition(previous, current, {
    visualDiffPercent: 0.015,
    threshold: 0.02,
  });

  assert.equal(transition.transitionKind, "state-change");
  assert.match(transition.inferredTransition, /content\/state changed on the same screen/i);
});

test("classifies a screen change when overlap collapses", () => {
  const previous = frame(1, [
    line("Dashboard", "top", 60),
    line("Orders", "top", 90),
    line("Status: Draft", "middle", 420),
  ]);
  const current = frame(2, [
    line("Sign in", "middle", 420),
    line("Username", "bottom", 620),
    line("Password", "bottom", 720),
  ]);

  const transition = classifyStoryboardTransition(previous, current, {
    visualDiffPercent: 0.8,
    threshold: 0.02,
  });

  assert.equal(transition.transitionKind, "screen-change");
});

test("uses same-screen sampling metadata to avoid false screen-change labels", () => {
  const previous = {
    ...frame(1, [
      line("Tech Helper", "top", 60),
      line("Win Network Guide", "top", 110),
      line("Step 2: Select the network", "middle", 360, 420),
      line("Message MC Tech Helper", "bottom", 860, 500),
    ]),
    samplingReason: "change-peak" as const,
    samplingSignal: "same-screen-change" as const,
    nearestChangeDistanceSeconds: 0,
    samplingScore: 0.94,
  };
  const current = {
    ...frame(2, [
      line("Tech Helper", "top", 60),
      line("Win Network Guide", "top", 110),
      line("Step 3: Enter credentials", "middle", 380, 440),
      line("Username: your MC email", "middle", 470, 460),
      line("Message MC Tech Helper", "bottom", 860, 500),
    ]),
    samplingReason: "change-peak" as const,
    samplingSignal: "same-screen-change" as const,
    nearestChangeDistanceSeconds: 0,
    samplingScore: 0.97,
  };

  const transition = classifyStoryboardTransition(previous, current, {
    visualDiffPercent: 0.13,
    threshold: 0.02,
  });

  assert.notEqual(transition.transitionKind, "screen-change");
  assert.ok(["state-change", "dialog-change"].includes(transition.transitionKind));
});
