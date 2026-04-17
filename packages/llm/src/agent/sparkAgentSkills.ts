import {
  GENERATED_SPARK_AGENT_SKILLS,
  type GeneratedSparkAgentSkillId,
} from "./generated/sparkAgentSkills.generated";

export type SparkAgentSkillId = GeneratedSparkAgentSkillId;

export type SparkAgentSkill = {
  readonly id: SparkAgentSkillId;
  readonly name: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly workspacePath: `skills/${string}/SKILL.md`;
  readonly frontmatter: Readonly<Record<string, string>>;
  readonly body: string;
  readonly content: string;
};

export type SparkAgentSkillFile = {
  readonly path: string;
  readonly content: string;
  readonly contentType: "text/markdown";
};

export const SPARK_AGENT_SKILL_IDS = GENERATED_SPARK_AGENT_SKILLS.map(
  (skill) => skill.id,
) as readonly SparkAgentSkillId[];

const SPARK_AGENT_SKILL_CATALOG = GENERATED_SPARK_AGENT_SKILLS.reduce(
  (catalog, skill) => {
    catalog[skill.id] = skill;
    return catalog;
  },
  {} as Record<SparkAgentSkillId, SparkAgentSkill>,
);

export const SPARK_SHEET_DRAFT_SKILL_IDS = [
  "paper-to-sheet",
  "source-image-cropping",
] as const satisfies readonly SparkAgentSkillId[];

export const SPARK_GRADER_SKILL_IDS = [
  "paper-to-sheet",
  "handwritten-answers-to-sheet",
  "source-image-cropping",
] as const satisfies readonly SparkAgentSkillId[];

export const SPARK_GAPS_FINDER_SKILL_IDS = [
  "gap-finder",
] as const satisfies readonly SparkAgentSkillId[];

export function resolveSparkAgentSkill(
  skillId: SparkAgentSkillId,
): SparkAgentSkill {
  return SPARK_AGENT_SKILL_CATALOG[skillId];
}

export function resolveSparkAgentSkills(
  skillIds: readonly SparkAgentSkillId[],
): SparkAgentSkill[] {
  return skillIds.map((skillId) => resolveSparkAgentSkill(skillId));
}

export function resolveSparkAgentSkillFiles(
  skillIds: readonly SparkAgentSkillId[],
): SparkAgentSkillFile[] {
  return resolveSparkAgentSkills(skillIds).map((skill) => ({
    path: skill.workspacePath,
    content: skill.content.trimEnd().concat("\n"),
    contentType: "text/markdown",
  }));
}

export function renderSparkAgentSkillReadList(
  skillIds: readonly SparkAgentSkillId[],
): string {
  return resolveSparkAgentSkills(skillIds)
    .map((skill) => `- ${skill.workspacePath} - ${skill.description}`)
    .join("\n");
}

export function renderSparkAgentSkillPromptSection(options: {
  heading: string;
  skillIds: readonly SparkAgentSkillId[];
}): string {
  const skillList = renderSparkAgentSkillReadList(options.skillIds);
  return [
    `## ${options.heading}`,
    "",
    "These are reusable workflow modules. Read the relevant skill files before doing the task-specific work, then follow the task file for run-specific inputs, output paths, and publishing requirements.",
    "",
    skillList,
  ].join("\n");
}

export function renderSparkAgentSkillContentSection(options: {
  heading: string;
  skillIds: readonly SparkAgentSkillId[];
}): string {
  return [
    `## ${options.heading}`,
    "",
    "Follow these reusable workflow modules:",
    "",
    ...resolveSparkAgentSkills(options.skillIds).flatMap((skill) => [
      `### ${skill.workspacePath}`,
      "",
      "~~~markdown",
      skill.content.trimEnd(),
      "~~~",
      "",
    ]),
  ].join("\n");
}
