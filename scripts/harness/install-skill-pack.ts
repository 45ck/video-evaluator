#!/usr/bin/env node
import { InstallSkillPackRequestSchema, installSkillPack, runHarnessTool } from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/install-skill-pack",
  inputSchema: InstallSkillPackRequestSchema,
  handler: async ({ input }) => installSkillPack(input),
});
