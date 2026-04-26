import { ocrStoryboard } from "../core/storyboard-ocr.js";
import {
  StoryboardOcrRequestSchema,
  type StoryboardOcrRequest,
} from "../core/schemas.js";

export async function runStoryboardOcr(input: StoryboardOcrRequest) {
  return ocrStoryboard(input);
}

export { StoryboardOcrRequestSchema };
