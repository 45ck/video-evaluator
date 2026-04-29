#!/usr/bin/env node
import {
  AnalyzeBundleRequestSchema,
  runAnalyzeBundle,
  runHarnessTool,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/analyze-bundle",
  inputSchema: AnalyzeBundleRequestSchema,
  handler: async ({ input }) => runAnalyzeBundle(input),
});
