import type { SparkAgentRunLog, SparkAgentState } from '@spark/schemas';

type AgentRunTimestampState = Pick<SparkAgentState, 'createdAt' | 'updatedAt'>;
type AgentRunTimestampLog = Pick<SparkAgentRunLog, 'updatedAt' | 'stream' | 'lines'>;

function getTimeOrNull(value: Date | undefined): number | null {
	if (!(value instanceof Date)) {
		return null;
	}
	const time = value.getTime();
	if (!Number.isFinite(time)) {
		return null;
	}
	return time;
}

export function resolveSparkAgentRunUpdatedAt(
	agent: AgentRunTimestampState | null | undefined,
	runLog: AgentRunTimestampLog | null | undefined
): Date | undefined {
	const lastLineTimestamp =
		runLog && runLog.lines.length > 0 ? runLog.lines[runLog.lines.length - 1]?.timestamp : undefined;
	const candidateTimes = [
		getTimeOrNull(agent?.updatedAt),
		getTimeOrNull(runLog?.updatedAt),
		getTimeOrNull(runLog?.stream?.updatedAt),
		getTimeOrNull(lastLineTimestamp)
	].filter((value): value is number => value !== null);

	if (candidateTimes.length === 0) {
		return agent?.createdAt;
	}

	return new Date(Math.max(...candidateTimes));
}
