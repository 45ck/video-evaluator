#!/usr/bin/env node
import { CompareBundlesRequestSchema, compareBundles, runHarnessTool } from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/compare-bundles",
  inputSchema: CompareBundlesRequestSchema,
  handler: async ({ input }) => compareBundles(input),
});
