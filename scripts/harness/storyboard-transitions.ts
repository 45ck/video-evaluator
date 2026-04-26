#!/usr/bin/env node
import {
  StoryboardTransitionsRequestSchema,
  runHarnessTool,
  runStoryboardTransitions,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/storyboard-transitions",
  inputSchema: StoryboardTransitionsRequestSchema,
  handler: async ({ input }) => runStoryboardTransitions(input),
});
