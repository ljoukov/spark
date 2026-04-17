import { resolveSparkAgentSkills, SPARK_AGENT_SKILL_IDS } from '@spark/llm';

export const load = () => {
	const skills = resolveSparkAgentSkills(SPARK_AGENT_SKILL_IDS).map((skill) => ({
		id: skill.id,
		name: skill.name,
		description: skill.description,
		sourcePath: skill.sourcePath,
		workspacePath: skill.workspacePath,
		frontmatter: skill.frontmatter,
		body: skill.body,
		content: skill.content
	}));

	return { skills };
};
