#!/usr/bin/env node
import {
  StoryboardExtractRequestSchema,
  runHarnessTool,
  runStoryboardExtract,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/storyboard-extract",
  inputSchema: StoryboardExtractRequestSchema,
  handler: async ({ input }) => runStoryboardExtract(input),
});
