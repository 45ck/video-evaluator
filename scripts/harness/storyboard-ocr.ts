#!/usr/bin/env node
import {
  StoryboardOcrRequestSchema,
  runHarnessTool,
  runStoryboardOcr,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/storyboard-ocr",
  inputSchema: StoryboardOcrRequestSchema,
  handler: async ({ input }) => runStoryboardOcr(input),
});
