import { intakeBundle } from "../core/bundle.js";
import { ReviewBundleRequestSchema, type ReviewBundleRequest } from "../core/schemas.js";

export async function reviewBundle(input: ReviewBundleRequest) {
  const bundle = await intakeBundle(input);
  const reviewQuestions = input.includePromptHints
    ? [
        "What failed or looks risky in this run?",
        "Are pacing, readability, and visual clarity acceptable?",
        "Which artifact should be inspected first to debug the run?",
      ]
    : [];
  return {
    bundle,
    reviewQuestions,
  };
}

export { ReviewBundleRequestSchema };
