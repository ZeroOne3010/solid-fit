import { describe, expect, it } from "vitest";
import { calculateStatistics } from "./calculate";
import type {
  NormalizedActivity,
  NormalizedTrackPoint,
} from "../model/activity";

const point = (seconds: number, metres = 0): NormalizedTrackPoint => ({
  latitude: 0,
  longitude: metres / 111319.49,
  time: new Date(1_700_000_000_000 + seconds * 1000),
});
const activity = (
  ...segments: NormalizedTrackPoint[][]
): NormalizedActivity => ({
  sourceFilename: "test.gpx",
  sourceHash: "a".repeat(64),
  activityType: "Cycling",
  tracks: [{ segments: segments.map((points) => ({ points })) }],
  warnings: [],
});

describe("sustained-stop moving time", () => {
  it("keeps continuous slow movement and isolated low-speed intervals", () => {
    const slow = calculateStatistics(
      activity([point(0), point(10, 1.4), point(20, 2.8)]),
    );
    const isolated = calculateStatistics(
      activity([point(0), point(5), point(10, 10)]),
    );
    expect(slow.movingSeconds).toBe(20);
    expect(isolated.movingSeconds).toBe(10);
  });

  it("does not count brief stationary jitter, but removes a confirmed stationary cluster", () => {
    const brief = calculateStatistics(
      activity([point(0), point(4, 1), point(8, 0), point(9, 10)]),
    );
    const stopped = calculateStatistics(
      activity([
        point(0),
        point(5, 1),
        point(10, 0),
        point(15, 1),
        point(20, 0),
        point(25, 15),
      ]),
    );
    expect(brief.movingSeconds).toBe(9);
    expect(stopped.movingSeconds).toBe(5);
  });

  it("resumes using speed and radius hysteresis, without crossing segments", () => {
    const resumed = calculateStatistics(
      activity([
        point(0),
        point(5),
        point(10),
        point(15),
        point(20, 20),
        point(25, 40),
      ]),
    );
    const boundaries = calculateStatistics(
      activity([point(0), point(5)], [point(10), point(15)]),
    );
    expect(resumed.movingSeconds).toBe(10);
    expect(boundaries.movingSeconds).toBe(10);
  });

  it("ignores invalid timestamp deltas safely", () => {
    const stats = calculateStatistics(
      activity([point(0), point(10), point(5), point(15)]),
    );
    expect(stats.movingSeconds).toBe(20);
  });
});

describe("centred maximum speed", () => {
  it("retains a genuine short two-second speed peak", () => {
    const stats = calculateStatistics(
      activity([point(0), point(1, 8), point(2, 16)]),
    );
    expect(stats.maximumKmh).toBeCloseTo(28.8, 0);
  });

  it("rejects an isolated one-interval GPS spike and implausible speeds", () => {
    const spike = calculateStatistics(
      activity([point(0), point(1, 100), point(2)]),
    );
    const implausible = calculateStatistics(
      activity([point(0), point(1, 100), point(2, 200)]),
    );
    expect(spike.maximumKmh).toBeCloseTo(0, 5);
    expect(implausible.maximumKmh).toBeUndefined();
  });

  it("accepts adjacent corroborating high-speed windows", () => {
    const stats = calculateStatistics(
      activity([
        point(0),
        point(1, 15),
        point(2, 30),
        point(3, 45),
        point(4, 60),
      ]),
    );
    expect(stats.maximumKmh).toBeCloseTo(54, 0);
  });

  it("never crosses segment boundaries and ignores duplicate timestamps", () => {
    const boundary = calculateStatistics(
      activity([point(0), point(1, 10)], [point(2, 20), point(3, 30)]),
    );
    const duplicate = calculateStatistics(
      activity([point(0), point(0, 10), point(1, 20)]),
    );
    expect(boundary.maximumKmh).toBeUndefined();
    expect(duplicate.maximumKmh).toBeUndefined();
  });
});
