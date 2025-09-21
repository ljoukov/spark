import { Duration } from '$proto/google/protobuf/duration';
import { PbLong } from '@protobuf-ts/runtime';

const toDuration = ([seconds, nanos]: [number, number]): Duration => {
	return { seconds: PbLong.from(seconds).toString(), nanos };
};

const hr: {
	now: () => [number, number];
	delta: (from: [number, number]) => [number, number];
} =
	typeof process !== 'undefined'
		? {
				now: () => {
					return process.hrtime();
				},
				delta: (from: [number, number]) => {
					return process.hrtime(from);
				}
			}
		: {
				now: () => {
					const now = Date.now() * 1e-3;
					const seconds = Math.floor(now);
					const nanoseconds = Math.floor((now % 1) * 1e9);
					return [seconds, nanoseconds];
				},
				delta: ([fromSeconds, fromNanoseconds]: [number, number]) => {
					const now = Date.now() * 1e-3;
					let seconds = Math.floor(now);
					let nanoseconds = Math.floor((now % 1) * 1e9);
					seconds -= fromSeconds;
					nanoseconds -= fromNanoseconds;
					if (nanoseconds < 0) {
						seconds--;
						nanoseconds += 1e9;
					}
					return [seconds, nanoseconds];
				}
			};

export function newTimer() {
	let start = hr.now();
	return {
		restart: function (): void {
			start = hr.now();
		},
		lap: function (): Duration {
			const delta = hr.delta(start);
			start = hr.now();
			return toDuration(delta);
		},
		lapStr: function (): string {
			return Duration.toJson(this.lap())!.toString();
		},
		elapsed: function (): Duration {
			const delta = hr.delta(start);
			return toDuration(delta);
		},
		elapsedStr: function (): string {
			return Duration.toJson(this.elapsed())!.toString();
		}
	};
}

export function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
