#!/usr/bin/env node
import { SkillCatalogRequestSchema, listSkillCatalog, runHarnessTool } from "../../src/index.ts";

await runHarnessTool({
  tool: "video-evaluator/skill-catalog",
  inputSchema: SkillCatalogRequestSchema,
  handler: async ({ input }) => listSkillCatalog(input),
});
