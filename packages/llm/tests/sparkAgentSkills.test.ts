import { describe, expect, it } from "vitest";

import {
  resolveSparkAgentSkills,
  SPARK_AGENT_SKILL_IDS,
} from "../src/agent/sparkAgentSkills";

describe("spark agent skills", () => {
  it("exposes generated skill metadata and full markdown content", () => {
    const skills = resolveSparkAgentSkills(SPARK_AGENT_SKILL_IDS);

    expect(skills.map((skill) => skill.id)).toEqual([
      "paper-to-sheet",
      "handwritten-answers-to-sheet",
      "source-image-cropping",
      "gap-finder",
    ]);
    for (const skill of skills) {
      expect(skill.sourcePath).toBe(`skills/${skill.id}/SKILL.md`);
      expect(skill.workspacePath).toBe(`skills/${skill.id}/SKILL.md`);
      expect(skill.frontmatter.name).toBe(skill.id);
      expect(skill.frontmatter.description).toBe(skill.description);
      expect(skill.content).toContain("---\n");
      expect(skill.content).toContain(`# `);
      expect(skill.body).not.toContain("name: ");
    }
  });
});
