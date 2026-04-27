# Roadmap

This roadmap tracks capability gaps and maintenance priorities for
`video-evaluator`. It is intentionally conservative: the pack should improve its
evidence quality before making broader claims.

## Current Strengths

- Produces structured storyboard artifacts from local videos.
- Supports first-pass review of UI-heavy demos and walkthroughs.
- Separates raw OCR lines from filtered semantic UI evidence.
- Reports weak or rejected OCR frames instead of treating all text as proof.
- Infers coarse transitions between sampled frames.
- Packages evidence for agent review and bundle comparison.
- Ships as a standalone skill pack for use across repos.
- Normalizes producer timestamps, captions, and action logs into
  `timeline.evidence.json`.
- Extracts coarse shot segments and representative frames into
  `video.shots.json`.
- Fuses shot, storyboard, OCR, transition, and timeline artifacts into
  `segment.evidence.json`.
- Produces per-shot storyboard frames with `segment-storyboard` to reduce empty
  segment evidence.

## Known Weak Spots

- OCR can fail on small fonts, compressed videos, low contrast, motion blur, and
  subtitle-heavy public videos.
- App names, views, and capabilities are still heuristic and can be sparse or
  wrong when OCR signal is weak.
- Transition inference is coarse. It should not be read as exact
  click-by-click reconstruction.
- Hybrid sampling can miss short-lived UI states between sampled frames.
- Public-video benchmark success may only prove the pipeline ran, not that the
  system understood the video.
- Non-UI domains such as gameplay, vlogs, cooking, talks, sports, and cinematic
  footage remain poor fits.
- Timeline evidence is not yet fused with storyboard/OCR evidence into a
  higher-level semantic timeline.
- Shot evidence is scene-boundary based. It helps split videos into parts, but
  it does not identify intent, sources, or exact edits by itself.
- Segment evidence routes available artifacts into the right time ranges; it
  still depends on the quality of those underlying artifacts.
- Segment storyboards improve coverage but still sample sparse still frames,
  not continuous motion.

## Near-Term Priorities

1. Improve OCR quality gates before semantic inference.
2. Evaluate segment-storyboard coverage across diverse local benchmark videos.
3. Strengthen subtitle, caption, narration, and overlay filtering.
4. Prefer stable UI-anchor frames when summarizing flows.
5. Improve app, view, and capability extraction for generic software demos.
6. Add clearer regression fixtures for low-signal, narration-dominated, and
   subtitle-dominated cases.
7. Keep benchmark reports honest by separating operational success from
   meaningful semantic recovery.

## Medium-Term Priorities

1. Add richer action-sequence reconstruction for UI-heavy local videos.
2. Improve comparison reports so before/after changes are easier to audit.
3. Version artifact contracts when fields become relied upon by other repos.
4. Add more deterministic fixtures that do not depend on public-video
   availability.
5. Improve installed-pack ergonomics and diagnostics for missing tools such as
   `ffmpeg`, `ffprobe`, or OCR assets.
6. Add `visual.probes.json` and turn segment evidence into a richer semantic
   timeline when evidence quality is strong enough.

## Non-Goals

The project should not become:

- a video renderer
- a creator-style cloning system
- an arbitrary YouTube understanding benchmark leaderboard
- a replacement for product-specific QA assertions
- a system that claims semantic certainty when evidence is weak

## Release Readiness Signals

A change is release-ready when:

- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Artifact changes are documented.
- Skill-pack installation still works.
- Low-signal cases still abstain clearly.
- Benchmark claims are written in terms of evidence, not hype.

## How To Prioritize Work

Prefer changes that make the system more trustworthy before changes that make it
sound more capable. A small improvement in abstention behavior is usually more
valuable than a broad semantic label that cannot be traced back to the
artifacts.
