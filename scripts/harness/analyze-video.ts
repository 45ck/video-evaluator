#!/usr/bin/env node
import {
  AnalyzeVideoRequestSchema,
  runAnalyzeVideo,
  runHarnessTool,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/analyze-video",
  inputSchema: AnalyzeVideoRequestSchema,
  handler: async ({ input }) => runAnalyzeVideo(input),
});
