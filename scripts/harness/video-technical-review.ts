#!/usr/bin/env node
import {
  VideoTechnicalReviewRequestSchema,
  runHarnessTool,
  runVideoTechnicalReview,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/video-technical-review",
  inputSchema: VideoTechnicalReviewRequestSchema,
  handler: async ({ input }) => runVideoTechnicalReview(input),
});
