import type { Duration } from '$proto/google/protobuf/duration';
import { Timestamp } from '$proto/google/protobuf/timestamp';
import {
	addDurations,
	compareTimestamps,
	durationToNanos,
	isTimestampAfter,
	isTimestampBefore,
	timestampsEqual,
	nanosToDuration,
	secondsToDuration,
	durationToMillis,
	durationToSeconds
} from './time';
import { test, expect } from 'vitest';

test('compareTimestamps', () => {
	const d1 = new Date(2023, 2, 5, 18, 59, 12, 509);
	const d2 = new Date(2023, 2, 5, 18, 59, 12, 510);
	const dOld = new Date(1901, 2, 5, 18, 59, 12, 510);
	expect(compareTimestamps(Timestamp.fromDate(d1), Timestamp.fromDate(d1))).toBe(0);
	expect(compareTimestamps(Timestamp.fromDate(d1), Timestamp.fromDate(d2))).toBeLessThan(0);
	expect(compareTimestamps(Timestamp.fromDate(d2), Timestamp.fromDate(d1))).toBeGreaterThan(0);
	expect(compareTimestamps(Timestamp.fromDate(d1), Timestamp.fromDate(dOld))).toBeGreaterThan(0);
	expect(compareTimestamps(Timestamp.fromDate(dOld), Timestamp.fromDate(d1))).toBeLessThan(0);
});

test('isEqual', () => {
	const d1 = new Date(2023, 2, 5, 18, 59, 12, 509);
	const d2 = new Date(2023, 2, 5, 18, 59, 12, 510);
	const dOld = new Date(1901, 2, 5, 18, 59, 12, 510);
	expect(timestampsEqual(Timestamp.fromDate(d1), Timestamp.fromDate(d1))).toBe(true);
	expect(timestampsEqual(Timestamp.fromDate(d1), Timestamp.fromDate(d2))).toBe(false);
	expect(timestampsEqual(Timestamp.fromDate(d1), Timestamp.fromDate(dOld))).toBe(false);
});

test('isBefore', () => {
	const d1 = new Date(2023, 2, 5, 18, 59, 12, 509);
	const d2 = new Date(2023, 2, 5, 18, 59, 12, 510);
	const dOld = new Date(1901, 2, 5, 18, 59, 12, 510);
	expect(isTimestampBefore(Timestamp.fromDate(d1), Timestamp.fromDate(d1))).toBe(false);
	expect(isTimestampBefore(Timestamp.fromDate(d1), Timestamp.fromDate(d2))).toBe(true);
	expect(isTimestampBefore(Timestamp.fromDate(d2), Timestamp.fromDate(d1))).toBe(false);
	expect(isTimestampBefore(Timestamp.fromDate(d1), Timestamp.fromDate(dOld))).toBe(false);
	expect(isTimestampBefore(Timestamp.fromDate(dOld), Timestamp.fromDate(d1))).toBe(true);
});

test('isAfter', () => {
	const d1 = new Date(2023, 2, 5, 18, 59, 12, 509);
	const d2 = new Date(2023, 2, 5, 18, 59, 12, 510);
	const dOld = new Date(1901, 2, 5, 18, 59, 12, 510);
	expect(isTimestampAfter(Timestamp.fromDate(d1), Timestamp.fromDate(d1))).toBe(false);
	expect(isTimestampAfter(Timestamp.fromDate(d1), Timestamp.fromDate(d2))).toBe(false);
	expect(isTimestampAfter(Timestamp.fromDate(d2), Timestamp.fromDate(d1))).toBe(true);
	expect(isTimestampAfter(Timestamp.fromDate(d1), Timestamp.fromDate(dOld))).toBe(true);
	expect(isTimestampAfter(Timestamp.fromDate(dOld), Timestamp.fromDate(d1))).toBe(false);
});

test('secondsToDuration', () => {
	expect(secondsToDuration(12)).toStrictEqual({ seconds: '12', nanos: 0 });
	expect(secondsToDuration(12.5)).toStrictEqual({ seconds: '12', nanos: 0.5 * 1e9 });
});

test('durationToNanos', () => {
	const d: Duration = { seconds: '12', nanos: 0.5 * 1e9 + 1 };
	expect(durationToNanos(d)).toStrictEqual(BigInt('12500000001'));
});

test('nanosToDuration', () => {
	const d: Duration = { seconds: '12', nanos: 0.5 * 1e9 + 1 };
	expect(nanosToDuration(durationToNanos(d))).toStrictEqual(d);
});

test('addDurations', () => {
	const d1: Duration = { seconds: '12', nanos: 0.5 * 1e9 + 1 };
	const d2: Duration = { seconds: '15', nanos: 0.25 * 1e9 + 4 };
	expect(addDurations(d1, d2)).toStrictEqual({ seconds: '27', nanos: 0.75 * 1e9 + 5 });
});

test('durationToMillis', () => {
	const d1: Duration = { seconds: '1', nanos: 0 };
	const d2: Duration = { seconds: '1', nanos: 500000000 }; // 0.5 seconds in nanos
	const d3: Duration = { seconds: '2', nanos: 250000000 }; // 0.25 seconds in nanos

	expect(durationToMillis(d1)).toBe(1000);
	expect(durationToMillis(d2)).toBe(1500);
	expect(durationToMillis(d3)).toBe(2250);
});

test('secondsToDuration and back roundtrip', () => {
	for (const seconds of [0, 1, 12, 12.345, 123456.789]) {
		const duration = secondsToDuration(seconds);
		const backToSeconds = Number(durationToSeconds(duration));
		const originalSeconds = Math.floor(seconds);
		expect(backToSeconds).toBe(originalSeconds);
	}
});
