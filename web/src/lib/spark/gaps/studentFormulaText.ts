const FORMULA_REPLACEMENTS: Array<[RegExp, string]> = [
	[/\\leq?/g, '<='],
	[/\\geq?/g, '>='],
	[/\\neq/g, '!='],
	[/\\times/g, '*'],
	[/\\cdot/g, '*'],
	[/\\div/g, '/'],
	[/\\pm/g, '+/-'],
	[/\\implies/g, '=>'],
	[/\\therefore/g, 'therefore'],
	[/\\because/g, 'because']
];

export function stripStudentFormulaMarkup(value: string): string {
	let stripped = value
		.replace(/\\\((.*?)\\\)/gs, '$1')
		.replace(/\\\[(.*?)\\\]/gs, '$1')
		.replace(/\$\$([^$]*?)\$\$/gs, '$1')
		.replace(/\$([^$\n]*?)\$/g, '$1');

	for (const [pattern, replacement] of FORMULA_REPLACEMENTS) {
		stripped = stripped.replace(pattern, replacement);
	}

	return stripped
		.replace(/\\([A-Za-z]+)/g, '$1')
		.replace(/[{}]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function stripStudentFormulaMarkupFromMap(
	values: Record<string, string> | undefined
): Record<string, string> {
	if (!values) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [key, stripStudentFormulaMarkup(value)])
	);
}
