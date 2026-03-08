export type GraderProblemReportSections = {
	statement: string | null;
	officialStatement: string | null;
	officialSolution: string | null;
	transcript: string | null;
	grading: string | null;
	annotations: string | null;
	overall: string | null;
	raw: string;
};

export function extractProblemReportSection(markdown: string, heading: string): string | null {
	const normalized = markdown.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	const headingLower = heading.trim().toLowerCase();
	let startIndex: number | null = null;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]?.trim();
		if (!line?.startsWith('## ')) {
			continue;
		}
		const title = line.slice(3).trim().toLowerCase();
		if (title === headingLower) {
			startIndex = index + 1;
			break;
		}
	}

	if (startIndex === null) {
		return null;
	}

	let endIndex = lines.length;
	for (let index = startIndex; index < lines.length; index += 1) {
		const line = lines[index]?.trim();
		if (line?.startsWith('## ')) {
			endIndex = index;
			break;
		}
	}

	const text = lines.slice(startIndex, endIndex).join('\n').trim();
	return text.length > 0 ? text : null;
}

export function parseGraderProblemReport(markdown: string): GraderProblemReportSections {
	return {
		statement: extractProblemReportSection(markdown, 'Problem statement'),
		officialStatement: extractProblemReportSection(markdown, 'Official problem statement'),
		officialSolution: extractProblemReportSection(markdown, 'Official solution'),
		transcript: extractProblemReportSection(markdown, 'Student solution transcript'),
		grading: extractProblemReportSection(markdown, 'Grading'),
		annotations: extractProblemReportSection(markdown, 'Annotation and feedback'),
		overall: extractProblemReportSection(markdown, 'Overall feedback'),
		raw: markdown
	};
}
