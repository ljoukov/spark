export type SlopAutoSignals = {
	tokens: number;
	sentences: number;
	infoEntropyMean: number;
	infoEntropyCv: number;
	ideaDensity: number;
	repetitionCompressionRatio: number;
	templatesPerToken: number;
	subjLexiconRatio: number;
	avgSentenceLen: number;
	fleschReadingEase: number;
	fkGrade: number;
	gunningFog: number;
};

const SUBJECTIVE_WORDS = new Set(
	[
		'believe',
		'feel',
		'seems',
		'apparently',
		'arguably',
		'probably',
		'perhaps',
		'maybe',
		'often',
		'likely',
		'unlikely',
		'suggests',
		'hint',
		'opinion',
		'subjective',
		'prefer',
		'think',
		'imagine',
		'hope',
		'worry',
		'concern',
		'beloved',
		'amazing',
		'terrible',
		'awful',
		'fantastic',
		'wonderful',
		'horrible',
		'exciting',
		'boring',
		'thrilling',
		'shocking',
		'dramatic',
		'controversial',
		'speculative',
		'rumour',
		'rumor',
		'argue',
		'claim',
		'claims',
		'claimed',
		'assert',
		'asserts',
		'allege',
		'alleged',
		'supposed',
		'suspect',
		'suspected',
		'suggested'
	].map((word) => word.toLowerCase())
);

const WORD_REGEX = /[A-Za-z']+/g;
const SENTENCE_REGEX = /[^.!?\n]+[.!?]*/g;

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function tokenizeWords(text: string): string[] {
	return (text.match(WORD_REGEX) ?? []).map((token) => token.toLowerCase());
}

function splitSentences(text: string): string[] {
	const matches = text.match(SENTENCE_REGEX) ?? [];
	return matches.map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

function syllableCount(word: string): number {
	const normalized = word.toLowerCase().replace(/[^a-z]/g, '');
	if (!normalized) {
		return 0;
	}
	if (normalized.length <= 3) {
		return 1;
	}
	const vowelGroups = normalized.match(/[aeiouy]{1,2}/g) ?? [];
	let syllables = vowelGroups.length;
	if (normalized.endsWith('e')) {
		syllables -= 1;
	}
	if (normalized.endsWith('le') && normalized.length > 2 && !/[aeiouy]le$/.test(normalized)) {
		syllables += 1;
	}
	return Math.max(1, syllables);
}

function computeEntropy(tokens: string[]): {
	mean: number;
	cv: number;
} {
	if (tokens.length === 0) {
		return { mean: 0, cv: 0 };
	}
	const frequency = new Map<string, number>();
	for (const token of tokens) {
		frequency.set(token, (frequency.get(token) ?? 0) + 1);
	}
	const total = tokens.length;
	const infoValues: number[] = tokens.map((token) => {
		const probability = (frequency.get(token) ?? 0) / total;
		return probability > 0 ? -Math.log2(probability) : 0;
	});
	const mean = infoValues.reduce((sum, value) => sum + value, 0) / infoValues.length;
	const variance =
		infoValues.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / infoValues.length;
	const stdDev = Math.sqrt(variance);
	const cv = mean === 0 ? 0 : stdDev / mean;
	return { mean, cv };
}

function computeIdeaDensity(tokens: string[], sentences: string[]): number {
	if (tokens.length === 0 || sentences.length === 0) {
		return 0;
	}
	const contentWords = tokens.filter((token) => token.length > 4);
	const uniqueContent = new Set(contentWords);
	return uniqueContent.size / sentences.length;
}

function computeCompressionRatio(tokens: string[]): number {
	if (tokens.length === 0) {
		return 0;
	}
	const uniqueTokens = new Set(tokens);
	return tokens.length / uniqueTokens.size;
}

function computeTemplateRate(tokens: string[]): number {
	if (tokens.length < 2) {
		return 0;
	}
	const bigramCounts = new Map<string, number>();
	for (let index = 0; index < tokens.length - 1; index += 1) {
		const key = `${tokens[index]}_${tokens[index + 1]}`;
		bigramCounts.set(key, (bigramCounts.get(key) ?? 0) + 1);
	}
	let repeated = 0;
	bigramCounts.forEach((count) => {
		if (count > 1) {
			repeated += count;
		}
	});
	return repeated / tokens.length;
}

function computeSubjectiveRatio(tokens: string[]): number {
	if (tokens.length === 0) {
		return 0;
	}
	const subjectiveCount = tokens.filter((token) => SUBJECTIVE_WORDS.has(token)).length;
	return subjectiveCount / tokens.length;
}

function safe(value: number): number {
	return Number.isFinite(value) ? value : 0;
}

export function computeSlopAutoSignals(text: string): SlopAutoSignals {
	const tokens = tokenizeWords(text);
	const sentences = splitSentences(text);
	const tokenCount = tokens.length;
	const sentenceCount = sentences.length || (tokenCount > 0 ? 1 : 0);

	let syllableTotal = 0;
	let complexWords = 0;
	for (const token of tokens) {
		const syllables = syllableCount(token);
		syllableTotal += syllables;
		if (syllables >= 3) {
			complexWords += 1;
		}
	}

	const avgSentenceLen = tokenCount / (sentenceCount || 1);
	const avgSyllablesPerWord = tokenCount === 0 ? 0 : syllableTotal / tokenCount;

	const fleschReadingEase = safe(206.835 - 1.015 * avgSentenceLen - 84.6 * avgSyllablesPerWord);
	const fkGrade = safe(0.39 * avgSentenceLen + 11.8 * avgSyllablesPerWord - 15.59);
	const gunningFog = safe(
		0.4 * (avgSentenceLen + (tokenCount === 0 ? 0 : (complexWords / tokenCount) * 100))
	);

	const entropy = computeEntropy(tokens);
	const ideaDensity = computeIdeaDensity(tokens, sentences);
	const compressionRatio = computeCompressionRatio(tokens);
	const templateRate = computeTemplateRate(tokens);
	const subjectiveRatio = computeSubjectiveRatio(tokens);

	return {
		tokens: tokenCount,
		sentences: sentenceCount,
		infoEntropyMean: round(safe(entropy.mean)),
		infoEntropyCv: round(safe(entropy.cv)),
		ideaDensity: round(safe(ideaDensity)),
		repetitionCompressionRatio: round(safe(compressionRatio)),
		templatesPerToken: round(safe(templateRate)),
		subjLexiconRatio: round(safe(subjectiveRatio)),
		avgSentenceLen: round(safe(avgSentenceLen)),
		fleschReadingEase: round(fleschReadingEase),
		fkGrade: round(fkGrade),
		gunningFog: round(gunningFog)
	};
}

export function autoSignalsToMarkdown(signals: SlopAutoSignals): string {
	const entries: Array<[keyof SlopAutoSignals, string]> = [
		['tokens', 'tokens'],
		['sentences', 'sentences'],
		['infoEntropyMean', 'info_entropy_mean'],
		['infoEntropyCv', 'info_entropy_cv'],
		['ideaDensity', 'idea_density'],
		['repetitionCompressionRatio', 'repetition_compression_ratio'],
		['templatesPerToken', 'templates_per_token'],
		['subjLexiconRatio', 'subj_lexicon_ratio'],
		['avgSentenceLen', 'avg_sentence_len'],
		['fleschReadingEase', 'flesch_reading_ease'],
		['fkGrade', 'fk_grade'],
		['gunningFog', 'gunning_fog']
	];

	return entries.map(([key, label]) => `- ${label}: ${signals[key]}`).join('\n');
}
