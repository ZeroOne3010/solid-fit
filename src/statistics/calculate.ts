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

/**
 * Finds the fastest valid rolling window within one GPX segment. Consecutive
 * valid point pairs form a run; a non-increasing timestamp or non-finite
 * distance ends that run, so a window can never bridge invalid data or segment
 * boundaries. For each endpoint, the leading point advances while the window
 * still satisfies the configured minimum duration. This yields the shortest
 * qualifying (and therefore most local) rolling window for that endpoint,
 * while avoiding single-pair GPS spikes.
 */
function maximumRollingSpeed(
  points: NormalizedTrackPoint[],
  minimumSeconds: number,
): number | undefined {
  let maximum: number | undefined;
  let run: { point: NormalizedTrackPoint; distance: number }[] = [];
  const considerRun = () => {
    let start = 0;
    for (let end = 1; end < run.length; end++) {
      while (
        start + 1 < end &&
        (run[end].point.time!.getTime() -
          run[start + 1].point.time!.getTime()) /
          1000 >=
          minimumSeconds
      )
        start++;
      const duration =
        (run[end].point.time!.getTime() - run[start].point.time!.getTime()) /
        1000;
      if (duration < minimumSeconds || duration <= 0) continue;
      const distance = run[end].distance - run[start].distance;
      if (Number.isFinite(distance) && distance >= 0)
        maximum = Math.max(maximum ?? 0, distance / duration);
    }
  };
  const flush = () => {
    considerRun();
    run = [];
  };
  for (const point of points) {
    if (!point.time) {
      flush();
      continue;
    }
    if (!run.length) {
      run.push({ point, distance: 0 });
      continue;
    }
    const previous = run.at(-1)!;
    const duration =
      (point.time.getTime() - previous.point.time!.getTime()) / 1000;
    const distance = distanceBetween(previous.point, point);
    if (duration <= 0 || !Number.isFinite(distance)) {
      flush();
      run.push({ point, distance: 0 });
      continue;
    }
    run.push({ point, distance: previous.distance + distance });
  }
  flush();
  return maximum;
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
  result.endTime = timed.at(-1)?.time;
  if (result.startTime && result.endTime && result.endTime >= result.startTime)
    result.elapsedSeconds =
      (result.endTime.getTime() - result.startTime.getTime()) / 1000;
  let moving = 0,
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
          const speed = d / seconds;
          if (
            seconds <= movementDefaults.maximumAcceptedGapSeconds &&
            speed >= movementDefaults.minimumSpeedMetersPerSecond
          )
            moving += seconds;
        }
      }
      const segmentMaximum = maximumRollingSpeed(
        seg.points,
        movementDefaults.maximumSpeedWindowSeconds,
      );
      if (segmentMaximum !== undefined)
        maximumSpeed = Math.max(maximumSpeed ?? 0, segmentMaximum);
      const es = seg.points
        .map((p) => p.elevationMeters)
        .filter((v): v is number => v !== undefined);
      elevations.push(...es);
      if (es.length > 1) hasElevationPair = true;
      for (let i = 1; i < es.length; i++) {
        const delta = es[i] - es[i - 1];
        if (Math.abs(delta) >= movementDefaults.elevationNoiseThresholdMeters) {
          if (delta > 0)
            result.elevationGain = (result.elevationGain ?? 0) + delta;
          else result.elevationLoss = (result.elevationLoss ?? 0) - delta;
        }
      }
    }
  if (hasElevationPair) {
    result.elevationGain ??= 0;
    result.elevationLoss ??= 0;
  }
  result.movingSeconds = moving || undefined;
  if (moving) result.averageMovingKmh = (result.distanceMeters / moving) * 3.6;
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
