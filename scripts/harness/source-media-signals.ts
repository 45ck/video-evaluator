#!/usr/bin/env node
import {
  SourceMediaSignalsRequestSchema,
  runHarnessTool,
  runSourceMediaSignals,
} from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/source-media-signals",
  inputSchema: SourceMediaSignalsRequestSchema,
  handler: async ({ input }) => runSourceMediaSignals(input),
});
