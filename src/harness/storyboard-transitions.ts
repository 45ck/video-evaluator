import { inferStoryboardTransitions } from "../core/storyboard-transitions.js";
import {
  StoryboardTransitionsRequestSchema,
  type StoryboardTransitionsRequest,
} from "../core/schemas.js";

export async function runStoryboardTransitions(input: StoryboardTransitionsRequest) {
  return inferStoryboardTransitions(input);
}

export { StoryboardTransitionsRequestSchema };
