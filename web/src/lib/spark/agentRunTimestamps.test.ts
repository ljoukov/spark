import { describe, expect, it } from 'vitest';

import { resolveSparkAgentRunUpdatedAt } from './agentRunTimestamps';

describe('resolveSparkAgentRunUpdatedAt', () => {
	it('falls back to the agent updatedAt when there is no log activity', () => {
		const createdAt = new Date('2026-03-23T16:25:00.000Z');
		const updatedAt = new Date('2026-03-23T16:25:02.000Z');

		expect(resolveSparkAgentRunUpdatedAt({ createdAt, updatedAt }, null)).toEqual(updatedAt);
	});

	it('prefers the log document updatedAt when it is newer than the agent doc', () => {
		const createdAt = new Date('2026-03-23T16:25:00.000Z');
		const updatedAt = new Date('2026-03-23T16:25:02.000Z');
		const logUpdatedAt = new Date('2026-03-23T16:25:21.000Z');

		expect(
			resolveSparkAgentRunUpdatedAt(
				{ createdAt, updatedAt },
				{
					updatedAt: logUpdatedAt,
					lines: [],
					stream: undefined
				}
			)
		).toEqual(logUpdatedAt);
	});

	it('prefers the latest recorded log line timestamp over older log metadata', () => {
		const createdAt = new Date('2026-03-23T16:25:00.000Z');
		const updatedAt = new Date('2026-03-23T16:25:02.000Z');
		const logUpdatedAt = new Date('2026-03-23T16:25:10.000Z');
		const latestLineAt = new Date('2026-03-23T16:25:34.000Z');

		expect(
			resolveSparkAgentRunUpdatedAt(
				{ createdAt, updatedAt },
				{
					updatedAt: logUpdatedAt,
					stream: {
						updatedAt: new Date('2026-03-23T16:25:25.000Z'),
						assistant: '',
						thoughts: ''
					},
					lines: [
						{
							key: 't1742747110000_000',
							timestamp: new Date('2026-03-23T16:25:10.000Z'),
							line: 'start'
						},
						{
							key: 't1742747134000_000',
							timestamp: latestLineAt,
							line: 'done'
						}
					]
				}
			)
		).toEqual(latestLineAt);
	});
});
