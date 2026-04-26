import { understandStoryboard } from "../core/storyboard-understand.js";
import {
  StoryboardUnderstandRequestSchema,
  type StoryboardUnderstandRequest,
} from "../core/schemas.js";

export async function runStoryboardUnderstand(input: StoryboardUnderstandRequest) {
  return understandStoryboard(input);
}

export { StoryboardUnderstandRequestSchema };
