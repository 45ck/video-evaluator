#!/usr/bin/env node
import {
  LayoutSafetyReviewRequestSchema,
  runHarnessTool,
  runLayoutSafetyReview,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/layout-safety-review",
  inputSchema: LayoutSafetyReviewRequestSchema,
  handler: async ({ input }) => runLayoutSafetyReview(input),
});
