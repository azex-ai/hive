import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import fs from "fs";
import path from "path";

export async function GET() {
  const config = getConfig();
  let skillsDir = config.context?.skills_dir || "";

  if (!skillsDir) {
    const candidate = path.join(process.cwd(), ".claude", "skills");
    if (fs.existsSync(candidate)) skillsDir = candidate;
  }

  const skills: { name: string; description: string; enabled: boolean }[] = [];

  if (skillsDir && fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMD = path.join(skillsDir, entry.name, "SKILL.md");
      let description = "";
      if (fs.existsSync(skillMD)) {
        const content = fs.readFileSync(skillMD, "utf-8");
        // Extract description from frontmatter
        const lines = content.split("\n");
        if (lines[0]?.trim() === "---") {
          for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === "---") break;
            if (lines[i].startsWith("description:")) {
              description = lines[i].replace("description:", "").trim();
              break;
            }
          }
        }
      }
      skills.push({ name: entry.name, description, enabled: true });
    }
  }

  return NextResponse.json({ data: { skills_dir: skillsDir, skills } });
}
