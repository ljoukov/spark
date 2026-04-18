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
		expect(normalizeSheetSubjectKey('GCSE Computer Science J277')).toBe('computer_science');
	});

	it('keeps biology on the green palette', () => {
		expect(resolveSheetSubjectTheme({ key: 'biology' })).toEqual({
			id: 'apple-green',
			color: '#167A2F',
			accent: '#34C759',
			light: '#EAF8EE',
			border: '#A9E7B8',
			darkColor: '#8EF0A7',
			darkAccent: '#30D158',
			darkLight: '#12381E',
			darkBorder: '#2F7E43'
		});
	});

	it('maps core school subjects onto stable Apple palettes', () => {
		expect(resolveSheetSubjectTheme({ key: 'mathematics' }).id).toBe('apple-blue');
		expect(resolveSheetSubjectTheme({ key: 'chemistry' }).id).toBe('apple-purple');
		expect(resolveSheetSubjectTheme({ key: 'physics' }).id).toBe('apple-indigo');
		expect(resolveSheetSubjectTheme({ key: 'geography' }).id).toBe('apple-teal');
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
