import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { SlopAutoSignalsSchema, type SlopAutoSignals } from '$lib/types/slop';
import { SUBJECTIVE_WORDS } from './subjectivityLexicon';

const WORD_REGEX = /[\p{L}\p{N}']+/gu;
const SENTENCE_REGEX = /[^.!?]+[.!?]?/g;

const STOPWORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'but',
	'by',
	'for',
	'from',
	'had',
	'has',
	'have',
	'he',
	'her',
	'his',
	'i',
	'in',
	'is',
	'it',
	'its',
	'of',
	'on',
	'or',
	'that',
	'the',
	'their',
	'there',
	'they',
	'this',
	'to',
	'was',
	'were',
	'will',
	'with',
	'you'
]);

function tokenize(text: string): string[] {
	const matches = text.toLowerCase().match(WORD_REGEX);
	return matches ? matches.map((token) => token) : [];
}

function splitSentences(text: string): string[] {
	const matches = text.match(SENTENCE_REGEX);
	if (!matches) {
		return text.trim() ? [text.trim()] : [];
	}
	return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function countSyllables(word: string): number {
	const sanitized = word
		.toLowerCase()
		.replace(/[^a-z]/g, '')
		.replace(/e$/g, '');
	if (!sanitized) {
		return 1;
	}
	const matches = sanitized.match(/[aeiouy]+/g);
	if (!matches) {
		return 1;
	}
	const count = matches.length;
	return count > 0 ? count : 1;
}

function computeEntropy(tokens: string[]): { mean: number; cv: number } {
	if (tokens.length === 0) {
		return { mean: 0, cv: 0 };
	}
	const counts = new Map<string, number>();
	for (const token of tokens) {
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	const total = tokens.length;
	const entries: Array<{ p: number; surprisal: number }> = [];
	for (const count of counts.values()) {
		const p = count / total;
		const surprisal = -Math.log2(p);
		entries.push({ p, surprisal });
	}
	const mean = entries.reduce((sum, entry) => sum + entry.p * entry.surprisal, 0);
	const variance = entries.reduce(
		(sum, entry) => sum + entry.p * Math.pow(entry.surprisal - mean, 2),
		0
	);
	const stdDev = Math.sqrt(Math.max(variance, 0));
	const cv = mean > 0 ? stdDev / mean : 0;
	return { mean, cv };
}

function computeCompressionRatio(text: string): number {
	const source = Buffer.from(text, 'utf8');
	if (source.byteLength === 0) {
		return 0;
	}
	const compressed = brotliCompressSync(source, {
		params: {
			[zlibConstants.BROTLI_PARAM_QUALITY]: 4
		}
	});
	return compressed.byteLength / source.byteLength;
}

function computeTemplateDensity(tokens: string[]): number {
	if (tokens.length < 3) {
		return 0;
	}
	const counts = new Map<string, number>();
	for (let index = 0; index <= tokens.length - 3; index += 1) {
		const key = `${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	let repeats = 0;
	for (const value of counts.values()) {
		if (value > 1) {
			repeats += value - 1;
		}
	}
	return repeats / tokens.length;
}

export function computeAutoSignals(text: string): SlopAutoSignals {
	const tokens = tokenize(text);
	const sentences = splitSentences(text);
	const sentenceCount = Math.max(1, sentences.length);
	const tokenCount = tokens.length;

	const { mean: entropyMean, cv: entropyCv } = computeEntropy(tokens);

	const contentTokens = tokens.filter((token) => !STOPWORDS.has(token) && token.length > 2);
	const ideaDensity = tokenCount > 0 ? contentTokens.length / tokenCount : 0;

	const compressionRatio = computeCompressionRatio(text);
	const templateDensity = computeTemplateDensity(tokens);

	let subjectiveHits = 0;
	for (const token of tokens) {
		if (SUBJECTIVE_WORDS.has(token)) {
			subjectiveHits += 1;
		}
	}
	const subjectivityRatio = tokenCount > 0 ? subjectiveHits / tokenCount : 0;

	let syllableCount = 0;
	let complexWordCount = 0;
	for (const token of tokens) {
		const syllables = countSyllables(token);
		syllableCount += syllables;
		if (syllables >= 3) {
			complexWordCount += 1;
		}
	}

	const avgSentenceLen = tokenCount > 0 ? tokenCount / sentenceCount : 0;
	const avgSyllablesPerWord = tokenCount > 0 ? syllableCount / tokenCount : 0;
	const complexWordRatio = tokenCount > 0 ? complexWordCount / tokenCount : 0;

	const fleschReadingEase = 206.835 - 1.015 * avgSentenceLen - 84.6 * avgSyllablesPerWord;
	const fkGrade = 0.39 * avgSentenceLen + 11.8 * avgSyllablesPerWord - 15.59;
	const gunningFog = 0.4 * (avgSentenceLen + 100 * complexWordRatio);

	const signals: SlopAutoSignals = SlopAutoSignalsSchema.parse({
		tokens: tokenCount,
		sentences: sentenceCount,
		info_entropy_mean: entropyMean,
		info_entropy_cv: entropyCv,
		idea_density: ideaDensity,
		repetition_compression_ratio: compressionRatio,
		templates_per_token: templateDensity,
		subj_lexicon_ratio: subjectivityRatio,
		avg_sentence_len: avgSentenceLen,
		flesch_reading_ease: fleschReadingEase,
		fk_grade: fkGrade,
		gunning_fog: gunningFog,
		complex_word_ratio: complexWordRatio,
		syllables_per_word: avgSyllablesPerWord
	});

	return signals;
}
