import type { Duration } from '$proto/google/protobuf/duration';
import { Timestamp } from '$proto/google/protobuf/timestamp';
import { PbLong } from '@protobuf-ts/runtime';

function compare(a: PbLong, b: PbLong): number {
  if (a.hi < b.hi) {
    return -1;
  } else if (a.hi > b.hi) {
    return 1;
  }
  // a.hi == b.hi
  return a.lo < b.lo ? -1 : a.lo > b.lo ? 1 : 0;
}

export function compareTimestamps(a: Timestamp, b: Timestamp): number {
  const aSec = PbLong.from(a.seconds);
  const bSec = PbLong.from(b.seconds);
  const a_cmp_b = compare(aSec, bSec);
  if (a_cmp_b != 0) {
    return a_cmp_b;
  }
  return a.nanos - b.nanos;
}

export function compareOptionalTimestamps(a?: Timestamp, b?: Timestamp): number {
  if (!a) {
    if (!b) {
      return 0;
    } else {
      return -1;
    }
  }
  if (!b) {
    if (!a) {
      return 0;
    } else {
      return 1;
    }
  }
  return compareTimestamps(a, b);
}

export function timestampsEqual(a: Timestamp, b: Timestamp): boolean {
  return compareTimestamps(a, b) === 0;
}

export function optionalTimestampsEqual(a?: Timestamp, b?: Timestamp): boolean {
  return compareOptionalTimestamps(a, b) === 0;
}

export function isTimestampBefore(a: Timestamp, b: Timestamp): boolean {
  return compareTimestamps(a, b) < 0;
}

export function isTimestampAfter(a: Timestamp, b: Timestamp): boolean {
  return compareTimestamps(a, b) > 0;
}

export function millisToTimestamp(millis: number): Timestamp {
  return Timestamp.fromDate(new Date(millis));
}

export function optionalMillisToTimestamp(millis: number | undefined): Timestamp | undefined {
  if (millis === undefined) {
    return undefined;
  }
  return millisToTimestamp(millis);
}

export function timestampToMillis(timestamp: Timestamp): number {
  return Timestamp.toDate(timestamp).getTime();
}

export function optionalTimestampToMillis(timestamp?: Timestamp): number {
  return timestamp ? Timestamp.toDate(timestamp).getTime() : 0;
}

export function timestampToProtoMillis(timestamp: Timestamp): string {
  return PbLong.from(Timestamp.toDate(timestamp).getTime()).toString();
}

export const secToNano = BigInt('1000000000');

export function durationToNanos(d: Duration): bigint {
  return PbLong.from(d.seconds).toBigInt() * secToNano + BigInt(d.nanos);
}

export function durationToSeconds(d: Duration): bigint {
  return PbLong.from(d.seconds).toBigInt();
}

export function durationToMillis(d: Duration): number {
  return Number(durationToSeconds(d) * 1_000n) + d.nanos / 1_000_000;
}

export function optionalDurationToMillis(d?: Duration): number {
  return d ? durationToMillis(d) : 0;
}

export function secondsToDuration(seconds: number): Duration {
  const fracSeconds = seconds - Math.floor(seconds);
  const wholeSeconds = seconds - fracSeconds;
  const fracSecondsAsNanos = Math.floor(fracSeconds * 1e9);
  const nanos = BigInt(wholeSeconds) * secToNano + BigInt(fracSecondsAsNanos);
  return nanosToDuration(nanos);
}

export function nanosToDuration(durationNanos: bigint): Duration {
  const seconds = PbLong.from(durationNanos / secToNano).toString();
  const nanos = Number(durationNanos % secToNano);
  return { seconds, nanos };
}

export function addDurations(d1: Duration, d2: Duration): Duration {
  return nanosToDuration(durationToNanos(d1) + durationToNanos(d2));
}

export const TIMESTAMP_ZERO: Timestamp = { seconds: '0', nanos: 0 };
export const DURATION_ZERO: Duration = { seconds: '0', nanos: 0 };
