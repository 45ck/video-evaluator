#!/usr/bin/env node
import { ReviewBundleRequestSchema, reviewBundle, runHarnessTool } from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/review-bundle",
  inputSchema: ReviewBundleRequestSchema,
  handler: async ({ input }) => reviewBundle(input),
});
