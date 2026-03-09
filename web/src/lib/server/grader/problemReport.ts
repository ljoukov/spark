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

export type GraderProblemReportNumberedItem = {
	number: number;
	markdown: string;
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

export function parseMarkdownNumberedList(markdown: string | null): GraderProblemReportNumberedItem[] {
	if (!markdown) {
		return [];
	}

	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const items: GraderProblemReportNumberedItem[] = [];
	let currentNumber: number | null = null;
	let currentLines: string[] = [];

	function pushCurrent(): void {
		if (currentNumber === null) {
			return;
		}
		const value = currentLines.join('\n').trim();
		if (value.length > 0) {
			items.push({
				number: currentNumber,
				markdown: value
			});
		}
		currentNumber = null;
		currentLines = [];
	}

	for (const rawLine of lines) {
		const match = rawLine.match(/^\s*(\d+)\.\s+(.*)$/);
		if (match) {
			pushCurrent();
			currentNumber = Number.parseInt(match[1] ?? '', 10);
			currentLines = [match[2] ?? ''];
			continue;
		}
		if (currentNumber !== null) {
			currentLines.push(rawLine);
		}
	}

	pushCurrent();
	return items;
}

export function parseMarkdownBlocks(markdown: string | null): string[] {
	if (!markdown) {
		return [];
	}

	const normalized = markdown.replace(/\r\n?/g, '\n').trim();
	if (normalized.length === 0) {
		return [];
	}

	const blocks = normalized
		.split(/\n\s*\n/g)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);

	if (blocks.length === 0) {
		return [];
	}

	return blocks.flatMap((block) => {
		const listItems = block
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		const everyLineIsBullet =
			listItems.length > 1 && listItems.every((line) => /^[-*]\s+/.test(line));
		if (!everyLineIsBullet) {
			return [block];
		}
		return listItems.map((line) => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
	});
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
