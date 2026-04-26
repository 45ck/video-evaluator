import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SkillCatalogRequestSchema, type SkillCatalogRequest } from "../core/schemas.js";

function readFrontmatterField(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1]!.trim() : null;
}

export async function listSkillCatalog(_input: SkillCatalogRequest) {
  const repoRoot = resolve(dirnameFromImportMeta(), "../..");
  const skillsRoot = join(repoRoot, "skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsRoot, entry.name, "SKILL.md");
    const raw = await readFile(skillPath, "utf8");
    skills.push({
      slug: entry.name,
      name: readFrontmatterField(raw, "name") ?? entry.name,
      description: readFrontmatterField(raw, "description") ?? "",
      path: skillPath,
    });
  }
  return { skills };
}

function dirnameFromImportMeta(): string {
  return new URL(".", import.meta.url).pathname;
}

export { SkillCatalogRequestSchema };
