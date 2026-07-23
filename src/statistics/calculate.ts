import type {
  ActivityStatistics,
  NormalizedActivity,
  NormalizedTrackPoint,
} from "../model/activity";
import { movementDefaults } from "./config";

/** Haversine using the IUGG mean Earth radius of 6,371,008.8 metres. */
const R = 6371008.8;
const radians = (v: number) => (v * Math.PI) / 180;
export const distanceBetween = (
  a: NormalizedTrackPoint,
  b: NormalizedTrackPoint,
) => {
  const dLat = radians(b.latitude - a.latitude),
    dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Returns confirmed stopped seconds for one segment, without inferring edges. */
function stoppedSeconds(points: NormalizedTrackPoint[]): number {
  let stopped = 0;
  let candidate:
    | {
        centre: NormalizedTrackPoint;
        start: NormalizedTrackPoint;
        confirmed: boolean;
      }
    | undefined;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (!a.time || !b.time) {
      candidate = undefined;
      continue;
    }
    const seconds = (b.time.getTime() - a.time.getTime()) / 1000;
    const distance = distanceBetween(a, b);
    if (seconds <= 0 || !Number.isFinite(distance)) {
      candidate = undefined;
      continue;
    }
    const speedKmh = (distance / seconds) * 3.6;
    if (!candidate) {
      if (
        speedKmh < movementDefaults.stopEnterSpeedKmh &&
        distance <= movementDefaults.stopRadiusMeters
      )
        candidate = { centre: a, start: a, confirmed: false };
      continue;
    }
    const fromCentre = distanceBetween(candidate.centre, b);
    const resumed =
      speedKmh > movementDefaults.stopExitSpeedKmh ||
      fromCentre > movementDefaults.stopExitRadiusMeters;
    if (resumed) {
      candidate = undefined;
      continue;
    }
    if (
      !candidate.confirmed &&
      fromCentre > movementDefaults.stopContinuousMovementMeters
    ) {
      candidate = undefined;
      continue;
    }
    const duration =
      (b.time.getTime() - candidate.start.time!.getTime()) / 1000;
    if (
      !candidate.confirmed &&
      duration >= movementDefaults.stopMinDurationSeconds
    ) {
      stopped += duration;
      candidate.confirmed = true;
    } else if (candidate.confirmed) stopped += seconds;
  }
  return stopped;
}

/**
 * Calculates speeds centred on each three-point neighbourhood. Candidates over
 * 40 km/h or abrupt candidates require a similar overlapping estimate,
 * rejecting isolated jumps.
 */
function maximumCentredSpeed(
  points: NormalizedTrackPoint[],
): number | undefined {
  const candidates: {
    index: number;
    speed: number;
    requiresSupport: boolean;
  }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      middle = points[i],
      b = points[i + 1];
    if (!a.time || !middle.time || !b.time) continue;
    if (
      middle.time.getTime() <= a.time.getTime() ||
      b.time.getTime() <= middle.time.getTime()
    )
      continue;
    const seconds = (b.time.getTime() - a.time.getTime()) / 1000;
    const distance = distanceBetween(a, b);
    const speed = distance / seconds;
    if (
      seconds <= 0 ||
      !Number.isFinite(distance) ||
      speed * 3.6 > movementDefaults.maxValidSpeedKmh
    )
      continue;
    const beforeSeconds = (middle.time.getTime() - a.time.getTime()) / 1000;
    const afterSeconds = (b.time.getTime() - middle.time.getTime()) / 1000;
    const beforeKmh = (distanceBetween(a, middle) / beforeSeconds) * 3.6;
    const afterKmh = (distanceBetween(middle, b) / afterSeconds) * 3.6;
    const acceleration =
      Math.abs(afterKmh - beforeKmh) / ((beforeSeconds + afterSeconds) / 2);
    candidates.push({
      index: i,
      speed,
      requiresSupport:
        speed * 3.6 > movementDefaults.highSpeedCorroborationKmh ||
        acceleration > movementDefaults.maxAccelerationKmhPerSecond,
    });
  }
  const validated = candidates.filter((candidate) => {
    if (!candidate.requiresSupport) return true;
    return candidates.some(
      (other) =>
        // Adjacent centred windows share one point-to-point interval. Requiring
        // an index gap of two means a one-interval GPS jump cannot support
        // itself through its neighbouring window.
        Math.abs(other.index - candidate.index) === 2 &&
        Math.abs(other.speed - candidate.speed) / candidate.speed <=
          movementDefaults.highSpeedCorroborationTolerance,
    );
  });
  return validated.length
    ? Math.max(...validated.map((candidate) => candidate.speed))
    : undefined;
}

/**
 * Counts meaningful elevation movement without discarding a steady climb made
 * of small samples. The anchor moves only after the accumulated difference
 * reaches the noise threshold, so jitter around the anchor is ignored.
 */
function segmentElevationChange(elevations: number[]): {
  gain: number;
  loss: number;
} {
  let gain = 0;
  let loss = 0;
  let anchor = elevations[0];
  for (const elevation of elevations.slice(1)) {
    const delta = elevation - anchor;
    if (Math.abs(delta) < movementDefaults.elevationNoiseThresholdMeters)
      continue;
    if (delta > 0) gain += delta;
    else loss -= delta;
    anchor = elevation;
  }
  return { gain, loss };
}

export function calculateStatistics(
  activity: NormalizedActivity,
): ActivityStatistics {
  const all = activity.tracks.flatMap((t) =>
    t.segments.flatMap((s) => s.points),
  );
  const result: ActivityStatistics = { distanceMeters: 0 };
  if (!all.length) return result;
  result.start = all[0];
  result.end = all.at(-1);
  const timed = all.filter((p) => p.time);
  result.startTime = timed[0]?.time;
  result.startTimeText = timed[0]?.timeText;
  result.endTime = timed.at(-1)?.time;
  result.endTimeText = timed.at(-1)?.timeText;
  let validTrackSeconds = 0,
    maximumSpeed: number | undefined;
  const elevations: number[] = [];
  let hasElevationPair = false;
  for (const track of activity.tracks)
    for (const seg of track.segments) {
      for (let i = 1; i < seg.points.length; i++) {
        const a = seg.points[i - 1],
          b = seg.points[i],
          d = distanceBetween(a, b);
        if (Number.isFinite(d)) result.distanceMeters += d;
        if (a.time && b.time) {
          const seconds = (b.time.getTime() - a.time.getTime()) / 1000;
          if (seconds <= 0) {
            activity.warnings.push({
              code: "OUT_OF_ORDER_TIME",
              message: "A non-increasing timestamp pair was excluded.",
            });
            continue;
          }
          validTrackSeconds += seconds;
        }
      }
      validTrackSeconds -= stoppedSeconds(seg.points);
      const segmentMaximum = maximumCentredSpeed(seg.points);
      if (segmentMaximum !== undefined)
        maximumSpeed = Math.max(maximumSpeed ?? 0, segmentMaximum);
      const es = seg.points
        .map((p) => p.elevationMeters)
        .filter((v): v is number => v !== undefined);
      elevations.push(...es);
      if (es.length > 1) hasElevationPair = true;
      if (es.length > 1) {
        const change = segmentElevationChange(es);
        result.elevationGain = (result.elevationGain ?? 0) + change.gain;
        result.elevationLoss = (result.elevationLoss ?? 0) + change.loss;
      }
    }
  if (hasElevationPair) {
    result.elevationGain ??= 0;
    result.elevationLoss ??= 0;
  }
  result.movingSeconds = validTrackSeconds || undefined;
  if (validTrackSeconds)
    result.averageMovingKmh = (result.distanceMeters / validTrackSeconds) * 3.6;
  if (maximumSpeed !== undefined) result.maximumKmh = maximumSpeed * 3.6;
  if (elevations.length) {
    result.minimumElevation = Math.min(...elevations);
    result.maximumElevation = Math.max(...elevations);
  }
  const hs = all
    .map((p) => p.heartRateBpm)
    .filter((v): v is number => v !== undefined);
  if (hs.length)
    result.heartRate = {
      min: Math.min(...hs),
      max: Math.max(...hs),
      average: hs.reduce((a, b) => a + b, 0) / hs.length,
    };
  result.bounds = {
    minLatitude: Math.min(...all.map((p) => p.latitude)),
    maxLatitude: Math.max(...all.map((p) => p.latitude)),
    minLongitude: Math.min(...all.map((p) => p.longitude)),
    maxLongitude: Math.max(...all.map((p) => p.longitude)),
  };
  return result;
}
