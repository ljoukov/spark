import { brotliCompressSync } from 'node:zlib';

import type { SlopAutoSignals } from '$lib/llm/schemas';

import { countSubjectiveWords } from './subjectiveLexicon';

const WORD_REGEX = /[A-Za-z0-9']+/g;
const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/;

const STOPWORDS = new Set(
        [
                'a',
                'an',
                'and',
                'as',
                'at',
                'be',
                'but',
                'by',
                'for',
                'from',
                'in',
                'into',
                'is',
                'it',
                'of',
                'on',
                'or',
                'that',
                'the',
                'their',
                'to',
                'was',
                'were',
                'with'
        ].map((word) => word.toLowerCase())
);

function tokenize(text: string): string[] {
        const matches = text.toLowerCase().match(WORD_REGEX);
        if (!matches) {
                return [];
        }
        return matches;
}

function splitSentences(text: string): string[] {
        const trimmed = text.trim();
        if (!trimmed) {
                return [];
        }
        return trimmed.split(SENTENCE_SPLIT_REGEX).filter((sentence) => sentence.trim().length > 0);
}

function countSyllables(word: string): number {
        const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
        if (!cleaned) {
                return 0;
        }
        const vowels = 'aeiouy';
        let count = 0;
        let previousWasVowel = false;
        for (let i = 0; i < cleaned.length; i += 1) {
                const char = cleaned[i]!;
                const isVowel = vowels.includes(char);
                if (isVowel && !previousWasVowel) {
                        count += 1;
                }
                previousWasVowel = isVowel;
        }
        if (cleaned.endsWith('e') && count > 1) {
                count -= 1;
        }
        return Math.max(1, count);
}

function computeEntropy(tokens: readonly string[]): { mean: number; stddev: number } {
        if (tokens.length === 0) {
                return { mean: 0, stddev: 0 };
        }
        const counts = new Map<string, number>();
        for (const token of tokens) {
                counts.set(token, (counts.get(token) ?? 0) + 1);
        }
        const total = tokens.length;
        const entropies: number[] = [];
        for (const count of counts.values()) {
                const probability = count / total;
                const surprisal = -Math.log2(probability);
                for (let i = 0; i < count; i += 1) {
                        entropies.push(surprisal);
                }
        }
        const mean = entropies.reduce((sum, value) => sum + value, 0) / entropies.length;
        const variance =
                entropies.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / entropies.length;
        return { mean, stddev: Math.sqrt(variance) };
}

function compressionRatio(text: string): number {
        const buffer = Buffer.from(text, 'utf8');
        if (buffer.length === 0) {
                return 1;
        }
        try {
                const compressed = brotliCompressSync(buffer);
                if (compressed.length === 0) {
                        return 1;
                }
                return compressed.length / buffer.length;
        } catch {
                return 1;
        }
}

function templatesPerToken(tokens: readonly string[]): number {
        if (tokens.length < 3) {
                return 0;
        }
        const bigramCounts = new Map<string, number>();
        for (let i = 0; i < tokens.length - 1; i += 1) {
                const bigram = `${tokens[i]} ${tokens[i + 1]}`;
                bigramCounts.set(bigram, (bigramCounts.get(bigram) ?? 0) + 1);
        }
        let repeated = 0;
        for (const count of bigramCounts.values()) {
                if (count > 1) {
                        repeated += count;
                }
        }
        return repeated / tokens.length;
}

function contentWordCount(tokens: readonly string[]): number {
        return tokens.reduce((sum, token) => {
                if (token.length <= 3) {
                        return sum;
                }
                if (STOPWORDS.has(token)) {
                        return sum;
                }
                return sum + 1;
        }, 0);
}

function syllableStats(tokens: readonly string[]): {
        totalSyllables: number;
        complexWordCount: number;
} {
        let totalSyllables = 0;
        let complexWordCount = 0;
        for (const token of tokens) {
                const syllables = countSyllables(token);
                totalSyllables += syllables;
                if (syllables >= 3) {
                        complexWordCount += 1;
                }
        }
        return { totalSyllables, complexWordCount };
}

export function computeSlopAutoSignals(text: string): SlopAutoSignals {
        const tokens = tokenize(text);
        const sentences = splitSentences(text);
        const words = tokens.length;
        const sentenceCount = sentences.length || 1;
        const entropy = computeEntropy(tokens);
        const contentWords = contentWordCount(tokens);
        const ideaDensity = contentWords / sentenceCount;
        const compression = compressionRatio(text);
        const templateRatio = templatesPerToken(tokens);
        const subjectiveWordCount = countSubjectiveWords(tokens);
        const subjectiveRatio = words === 0 ? 0 : subjectiveWordCount / words;
        const averageSentenceLength = words / sentenceCount;
        const { totalSyllables, complexWordCount } = syllableStats(tokens);
        const syllablesPerWord = words === 0 ? 0 : totalSyllables / words;

        const fleschReadingEase =
                words === 0
                        ? 0
                        : 206.835 - 1.015 * averageSentenceLength - 84.6 * syllablesPerWord;
        const fleschKincaidGrade =
                words === 0
                        ? 0
                        : 0.39 * averageSentenceLength + 11.8 * syllablesPerWord - 15.59;
        const gunningFog =
                words === 0
                        ? 0
                        : 0.4 * (averageSentenceLength + (100 * complexWordCount) / Math.max(words, 1));

        return {
                tokens: tokens.length,
                sentences: sentences.length,
                words,
                info_entropy_mean: Number(entropy.mean.toFixed(4)),
                info_entropy_stddev: Number(entropy.stddev.toFixed(4)),
                idea_density: Number(ideaDensity.toFixed(4)),
                repetition_compression_ratio: Number(compression.toFixed(4)),
                templates_per_token: Number(templateRatio.toFixed(4)),
                subj_lexicon_ratio: Number(subjectiveRatio.toFixed(4)),
                avg_sentence_len: Number(averageSentenceLength.toFixed(4)),
                flesch_reading_ease: Number(fleschReadingEase.toFixed(2)),
                fk_grade: Number(fleschKincaidGrade.toFixed(2)),
                gunning_fog: Number(gunningFog.toFixed(2))
        } satisfies SlopAutoSignals;
}
