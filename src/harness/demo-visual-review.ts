import {
  DemoVisualReviewRequestSchema,
  type DemoVisualReviewRequest,
} from "../core/schemas.js";
import { reviewDemoVisualFrames } from "../visual/golden-frame.js";

export async function runDemoVisualReview(input: DemoVisualReviewRequest) {
  return reviewDemoVisualFrames(input);
}

export { DemoVisualReviewRequestSchema };
