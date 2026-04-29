import { reviewLayoutSafety } from "../core/layout-safety-review.js";
import {
  LayoutSafetyReviewRequestSchema,
  type LayoutSafetyReviewRequest,
} from "../core/schemas.js";

export async function runLayoutSafetyReview(input: LayoutSafetyReviewRequest) {
  return reviewLayoutSafety(input);
}

export { LayoutSafetyReviewRequestSchema };
