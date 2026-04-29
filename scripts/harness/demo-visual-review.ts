#!/usr/bin/env node
import {
  DemoVisualReviewRequestSchema,
  runDemoVisualReview,
  runHarnessTool,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/demo-visual-review",
  inputSchema: DemoVisualReviewRequestSchema,
  handler: async ({ input }) => runDemoVisualReview(input),
});
