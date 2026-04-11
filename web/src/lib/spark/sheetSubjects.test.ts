import { describe, expect, it } from 'vitest';

import {
	buildSheetSubjectTag,
	normalizeSheetSubjectKey,
	resolveSheetSubjectLabel,
	resolveSheetSubjectTheme
} from './sheetSubjects';

describe('sheetSubjects', () => {
	it('normalizes common subject aliases to stable filter keys', () => {
		expect(normalizeSheetSubjectKey('Biology')).toBe('biology');
		expect(normalizeSheetSubjectKey('Maths')).toBe('mathematics');
		expect(normalizeSheetSubjectKey('Combined Science')).toBe('science');
		expect(normalizeSheetSubjectKey('Combined Science: Trilogy Physics')).toBe('physics');
		expect(normalizeSheetSubjectKey('AQA GCSE Combined Science Trilogy Biology Paper 1H')).toBe(
			'biology'
		);
	});

	it('keeps biology on the green palette', () => {
		expect(resolveSheetSubjectTheme({ key: 'biology' })).toEqual({
			color: '#13795B',
			accent: '#1FA57A',
			light: '#E7F7F0',
			border: '#9FDCC7'
		});
	});

	it('builds subject tags with normalized keys and preserved labels', () => {
		expect(buildSheetSubjectTag('Physics')).toEqual({
			key: 'physics',
			label: 'Physics'
		});
		expect(buildSheetSubjectTag('Combined Science: Trilogy Physics')).toEqual({
			key: 'physics',
			label: 'Physics'
		});
	});

	it('prefers canonical labels for known subjects', () => {
		expect(
			resolveSheetSubjectLabel({
				key: 'physics',
				label: 'Combined Science: Trilogy Physics'
			})
		).toBe('Physics');
	});
});
