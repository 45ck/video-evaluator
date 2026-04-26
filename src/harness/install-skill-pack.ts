import { copySkillPack } from "../core/bundle.js";
import {
  InstallSkillPackRequestSchema,
  type InstallSkillPackRequest,
} from "../core/schemas.js";

export async function installSkillPack(input: InstallSkillPackRequest) {
  const copied = await copySkillPack(
    input.targetDir,
    input.includeAgentRunner,
    input.installDependencies,
  );
  return {
    targetDir: input.targetDir,
    copied,
    count: copied.length,
    installDependencies: input.installDependencies,
  };
}

export { InstallSkillPackRequestSchema };
