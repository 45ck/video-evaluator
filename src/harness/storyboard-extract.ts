import { extractStoryboard } from "../core/storyboard.js";
import {
  StoryboardExtractRequestSchema,
  type StoryboardExtractRequest,
} from "../core/schemas.js";

export async function runStoryboardExtract(input: StoryboardExtractRequest) {
  return extractStoryboard(input);
}

export { StoryboardExtractRequestSchema };
