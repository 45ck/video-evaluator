#!/usr/bin/env node
import { VideoShotsRequestSchema, runHarnessTool, runVideoShots } from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/video-shots",
  inputSchema: VideoShotsRequestSchema,
  handler: async ({ input }) => runVideoShots(input),
});
