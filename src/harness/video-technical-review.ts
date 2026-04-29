import { reviewVideoTechnical } from "../core/video-technical-review.js";
import {
  VideoTechnicalReviewRequestSchema,
  type VideoTechnicalReviewRequest,
} from "../core/schemas.js";

export async function runVideoTechnicalReview(
  input: VideoTechnicalReviewRequest,
) {
  return reviewVideoTechnical(input);
}

export { VideoTechnicalReviewRequestSchema };
