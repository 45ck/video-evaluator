#!/usr/bin/env node
import {
  GoldenFrameCompareRequestSchema,
  runGoldenFrameCompare,
  runHarnessTool,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/golden-frame-compare",
  inputSchema: GoldenFrameCompareRequestSchema,
  handler: async ({ input }) => runGoldenFrameCompare(input),
});
