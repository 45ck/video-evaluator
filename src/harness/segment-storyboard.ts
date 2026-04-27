import { extractSegmentStoryboard } from "../core/segment-storyboard.js";
import {
  SegmentStoryboardRequestSchema,
  type SegmentStoryboardRequest,
} from "../core/schemas.js";

export async function runSegmentStoryboard(input: SegmentStoryboardRequest) {
  return extractSegmentStoryboard(SegmentStoryboardRequestSchema.parse(input));
}

export { SegmentStoryboardRequestSchema };
