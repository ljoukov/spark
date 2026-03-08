export function formatRelativeAge(
	value: Date | string | number | null | undefined,
	options: {
		now?: Date | number;
	} = {}
): string {
	const resolved = resolveDate(value);
	if (!resolved) {
		return '—';
	}
	const now = resolveNow(options.now);
	const diffMs = Math.max(0, now.getTime() - resolved.getTime());
	const totalSeconds = Math.floor(diffMs / 1000);
	if (totalSeconds < 60) {
		const seconds = Math.max(totalSeconds, 1);
		return `${seconds.toString()} ${pluralise('sec', seconds)} ago`;
	}
	const totalMinutes = Math.floor(totalSeconds / 60);
	if (totalMinutes < 60) {
		return `${totalMinutes.toString()} ${pluralise('min', totalMinutes)} ago`;
	}
	const totalHours = Math.floor(totalMinutes / 60);
	if (totalHours < 24) {
		const minutes = totalMinutes % 60;
		if (minutes === 0) {
			return `${totalHours.toString()}h ago`;
		}
		return `${totalHours.toString()}h ${minutes.toString()} min ago`;
	}
	const totalDays = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	if (hours === 0) {
		return `${totalDays.toString()}d ago`;
	}
	return `${totalDays.toString()}d ${hours.toString()}h ago`;
}

function resolveDate(value: Date | string | number | null | undefined): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value === 'string' || typeof value === 'number') {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}
	return null;
}

function resolveNow(value: Date | number | undefined): Date {
	if (value instanceof Date) {
		return value;
	}
	if (typeof value === 'number') {
		return new Date(value);
	}
	return new Date();
}

function pluralise(unit: 'sec' | 'min', count: number): string {
	return count === 1 ? unit : `${unit}s`;
}
