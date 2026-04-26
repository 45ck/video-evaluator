#!/usr/bin/env node
import {
  PackageReviewPromptRequestSchema,
  packageReviewPrompt,
  runHarnessTool,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/package-review-prompt",
  inputSchema: PackageReviewPromptRequestSchema,
  handler: async ({ input }) => packageReviewPrompt(input),
});
