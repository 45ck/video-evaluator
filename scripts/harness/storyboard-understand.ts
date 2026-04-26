#!/usr/bin/env node
import {
  StoryboardUnderstandRequestSchema,
  runHarnessTool,
  runStoryboardUnderstand,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/storyboard-understand",
  inputSchema: StoryboardUnderstandRequestSchema,
  handler: async ({ input }) => runStoryboardUnderstand(input),
});
