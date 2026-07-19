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
    max = 0;
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
          if (seconds >= movementDefaults.maximumSpeedWindowSeconds)
            max = Math.max(max, speed);
        }
      }
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
  if (max) result.maximumKmh = max * 3.6;
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
