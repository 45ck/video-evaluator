import { copySkillPack } from "../core/bundle.js";
import {
  InstallSkillPackRequestSchema,
  type InstallSkillPackRequest,
} from "../core/schemas.js";

export async function installSkillPack(input: InstallSkillPackRequest) {
  const copied = await copySkillPack(input.targetDir, input.includeAgentRunner);
  return {
    targetDir: input.targetDir,
    copied,
    count: copied.length,
  };
}

export { InstallSkillPackRequestSchema };
