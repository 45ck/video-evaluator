#!/usr/bin/env node
import { SegmentEvidenceRequestSchema, runHarnessTool, runSegmentEvidence } from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/segment-evidence",
  inputSchema: SegmentEvidenceRequestSchema,
  handler: async ({ input }) => runSegmentEvidence(input),
});
