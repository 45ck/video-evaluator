#!/usr/bin/env node
import { SegmentStoryboardRequestSchema, runHarnessTool, runSegmentStoryboard } from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/segment-storyboard",
  inputSchema: SegmentStoryboardRequestSchema,
  handler: async ({ input }) => runSegmentStoryboard(input),
});
