#!/usr/bin/env node
import { VideoIntakeRequestSchema, runHarnessTool, runVideoIntake } from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/video-intake",
  inputSchema: VideoIntakeRequestSchema,
  handler: async ({ input }) => runVideoIntake(input),
});
