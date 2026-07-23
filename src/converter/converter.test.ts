import { describe, it, expect } from "vitest";
import { DataFactory, Parser } from "n3";
import { distanceBetween, calculateStatistics } from "../statistics/calculate";
import { createActivityId } from "../identifiers/createActivityId";
import { parseGpx } from "../formats/gpx/parseGpx";
import { serializeActivity } from "../rdf/serializeActivity";
import type { ActivityStatistics, NormalizedActivity } from "../model/activity";
import { summarizeActivities } from "../app/importSummary";
import afternoonRide from "./fixtures/afternoon-ride.gpx?raw";

const { namedNode } = DataFactory;
const SCHEMA = "https://schema.org/";
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const schema = (term: string) => namedNode(SCHEMA + term);

describe("conversion core", () => {
  it("keeps the Afternoon Ride regression metrics stable", () => {
    const activity = parseGpx(
      new TextEncoder().encode(afternoonRide),
      "afternoon-ride.gpx",
      "0".repeat(64),
    );
    const statistics = calculateStatistics(activity);
    expect(statistics.movingSeconds).toBeGreaterThanOrEqual(312);
    expect(statistics.movingSeconds).toBeLessThanOrEqual(313);
    expect(statistics.averageMovingKmh).toBeGreaterThan(14.3);
    expect(statistics.averageMovingKmh).toBeLessThan(14.4);
    expect(statistics.maximumKmh).toBeCloseTo(29, 0);
    expect(statistics.distanceMeters).toBeCloseTo(1244, -1);
    expect(statistics.elevationGain).toBe(8);
    expect(statistics.elevationLoss).toBe(0);
  });

  it("does not bridge segments and creates stable identifiers", async () => {
    const xml = `<gpx><trk><name>Ride</name><type>bike</type><trkseg><trkpt lat="60" lon="24"><time>2026-07-14T09:16:00Z</time></trkpt><trkpt lat="60" lon="24.01"><time>2026-07-14T09:16:10Z</time></trkpt></trkseg><trkseg><trkpt lat="61" lon="25"/></trkseg></trk></gpx>`;
    const activity = parseGpx(
      new TextEncoder().encode(xml),
      "test.gpx",
      "a".repeat(64),
    );
    const statistics = calculateStatistics(activity);
    expect(statistics.distanceMeters).toBeCloseTo(
      distanceBetween(
        activity.tracks[0].segments[0].points[0],
        activity.tracks[0].segments[0].points[1],
      ),
    );
    expect(createActivityId("a".repeat(64), statistics.startTime)).toBe(
      "20260714T091600Z-aaaaaaaaaaaa",
    );
    const turtle = await serializeActivity(
      activity,
      statistics,
      "../../source-files/2026/x.gpx",
    );
    expect(new Parser().parse(turtle).length).toBeGreaterThan(0);
  });

  it("uses segment-local centred windows for maximum speed rather than a GPS spike", () => {
    const xml = `<gpx><trk><trkseg><trkpt lat="0" lon="0"><time>2026-07-14T10:11:00Z</time></trkpt><trkpt lat="0" lon="0.01"><time>2026-07-14T10:11:01Z</time></trkpt><trkpt lat="0" lon="0.01"><time>2026-07-14T10:11:06Z</time></trkpt><trkpt lat="0" lon="0.0101"><time>2026-07-14T10:11:07Z</time></trkpt><trkpt lat="0" lon="0.0102"><time>2026-07-14T10:11:12Z</time></trkpt></trkseg><trkseg><trkpt lat="0" lon="1"><time>2026-07-14T10:11:13Z</time></trkpt><trkpt lat="0" lon="1.01"><time>2026-07-14T10:11:14Z</time></trkpt></trkseg></trk></gpx>`;
    const activity = parseGpx(
      new TextEncoder().encode(xml),
      "spike.gpx",
      "e".repeat(64),
    );
    const statistics = calculateStatistics(activity);

    // The one-second 0.01° jump is ~4,000 km/h and is rejected by the fixed
    // 100 km/h validation cap; no centred estimate bridges segments.
    expect(statistics.maximumKmh).toBeDefined();
    // The remaining local centred estimate is normal movement, not the jump.
    expect(statistics.maximumKmh!).toBeGreaterThan(10);
    expect(statistics.maximumKmh!).toBeLessThan(15);
  });

  it("retains timestamps from timed points when endpoints have coordinates only", async () => {
    const activity = parseGpx(
      new TextEncoder().encode(
        `<gpx><trk><trkseg><trkpt lat="60" lon="24"/><trkpt lat="60" lon="24.01"><time>2026-07-14T10:11:00Z</time></trkpt><trkpt lat="60" lon="24.02"><time>2026-07-14T10:11:06Z</time></trkpt><trkpt lat="60" lon="24.03"/></trkseg></trk></gpx>`,
      ),
      "endpoint-times.gpx",
      "1".repeat(64),
    );
    const quads = new Parser().parse(
      await serializeActivity(
        activity,
        calculateStatistics(activity),
        "../../source-files/2026/endpoint-times.gpx",
      ),
    );
    const timeValue = (property: string) =>
      quads.find(
        (quad) =>
          quad.subject.equals(namedNode("#activity")) &&
          quad.predicate.equals(schema(property)),
      )?.object;
    const start = timeValue("startTime"),
      end = timeValue("endTime");
    if (start?.termType !== "Literal" || end?.termType !== "Literal")
      throw new Error("Expected endpoint date literals");
    expect(start.value).toBe("2026-07-14T10:11:00Z");
    expect(end.value).toBe("2026-07-14T10:11:06Z");
  });

  it("preserves source-order locations, includes all valid points in bounds, and does not bridge elevation segments", async () => {
    const xml = `<gpx><trk><trkseg><trkpt lat="60.3" lon="25.4"><ele>10</ele></trkpt><trkpt lat="60.1" lon="25.9"><ele>20</ele></trkpt></trkseg><trkseg><trkpt lat="60.4" lon="25.2"><ele>100</ele></trkpt></trkseg></trk></gpx>`;
    const activity = parseGpx(
      new TextEncoder().encode(xml),
      "route.gpx",
      "c".repeat(64),
    );
    const statistics = calculateStatistics(activity);

    expect(statistics.start).toMatchObject({ latitude: 60.3, longitude: 25.4 });
    expect(statistics.end).toMatchObject({ latitude: 60.4, longitude: 25.2 });
    expect(statistics.bounds).toEqual({
      minLatitude: 60.1,
      minLongitude: 25.2,
      maxLatitude: 60.4,
      maxLongitude: 25.9,
    });
    expect(statistics.elevationGain).toBe(10);
    expect(statistics.elevationLoss).toBe(0);

    const quads = new Parser().parse(
      await serializeActivity(
        activity,
        statistics,
        "../../source-files/2026/route.gpx",
      ),
    );
    const objectFor = (
      subject: (typeof quads)[number]["object"],
      predicate: string,
    ) =>
      quads.find(
        (quad) =>
          quad.subject.equals(subject) &&
          quad.predicate.equals(schema(predicate)),
      )?.object;
    const locationCoordinates = (property: string) => {
      const place = objectFor(namedNode("#activity"), property)!;
      const geo = objectFor(place, "geo")!;
      return {
        latitude: objectFor(geo, "latitude")?.value,
        longitude: objectFor(geo, "longitude")?.value,
      };
    };

    expect(locationCoordinates("fromLocation")).toEqual({
      latitude: "60.3",
      longitude: "25.4",
    });
    expect(locationCoordinates("toLocation")).toEqual({
      latitude: "60.4",
      longitude: "25.2",
    });
    const boundsValue = objectFor(namedNode("#bounds"), "value")!;
    expect(objectFor(boundsValue, "box")?.value).toBe("60.1 25.2 60.4 25.9");
    for (const [id, property, value] of [
      ["elevation-gain", "ElevationGain", "10"],
      ["elevation-loss", "ElevationLoss", "0"],
    ]) {
      const observation = namedNode(`#${id}`);
      expect(objectFor(observation, "measuredProperty")?.value).toBe(property);
      const quantitativeValue = objectFor(observation, "value")!;
      expect(objectFor(quantitativeValue, "value")?.value).toBe(value);
    }
  });

  it("omits elevation change observations when no segment has two elevation samples", async () => {
    const activity = parseGpx(
      new TextEncoder().encode(
        '<gpx><trk><trkseg><trkpt lat="60" lon="24"><ele>12</ele></trkpt></trkseg><trkseg><trkpt lat="61" lon="25"><ele>100</ele></trkpt></trkseg></trk></gpx>',
      ),
      "sparse-elevation.gpx",
      "d".repeat(64),
    );
    const statistics = calculateStatistics(activity);
    expect(statistics.elevationGain).toBeUndefined();
    expect(statistics.elevationLoss).toBeUndefined();

    const turtle = await serializeActivity(
      activity,
      statistics,
      "../../source-files/2026/sparse-elevation.gpx",
    );
    const quads = new Parser().parse(turtle);
    expect(
      quads.some(
        (quad) =>
          quad.predicate.equals(schema("measuredProperty")) &&
          quad.object.value === "ElevationGain",
      ),
    ).toBe(false);
    expect(
      quads.some(
        (quad) =>
          quad.predicate.equals(schema("measuredProperty")) &&
          quad.object.value === "ElevationLoss",
      ),
    ).toBe(false);
  });

  it("accumulates gradual elevation changes while filtering jitter within each segment", () => {
    const gradualClimb = parseGpx(
      new TextEncoder().encode(
        '<gpx><trk><trkseg><trkpt lat="60" lon="24"><ele>100</ele></trkpt><trkpt lat="60" lon="24"><ele>101</ele></trkpt><trkpt lat="60" lon="24"><ele>102</ele></trkpt><trkpt lat="60" lon="24"><ele>103</ele></trkpt></trkseg></trk></gpx>',
      ),
      "gradual-climb.gpx",
      "1".repeat(64),
    );
    expect(calculateStatistics(gradualClimb)).toMatchObject({
      elevationGain: 3,
      elevationLoss: 0,
    });

    const noisyFlat = parseGpx(
      new TextEncoder().encode(
        '<gpx><trk><trkseg><trkpt lat="60" lon="24"><ele>100</ele></trkpt><trkpt lat="60" lon="24"><ele>101</ele></trkpt><trkpt lat="60" lon="24"><ele>99</ele></trkpt><trkpt lat="60" lon="24"><ele>100</ele></trkpt></trkseg></trk></gpx>',
      ),
      "noisy-flat.gpx",
      "2".repeat(64),
    );
    expect(calculateStatistics(noisyFlat)).toMatchObject({
      elevationGain: 0,
      elevationLoss: 0,
    });

    const separateSegments = parseGpx(
      new TextEncoder().encode(
        '<gpx><trk><trkseg><trkpt lat="60" lon="24"><ele>100</ele></trkpt><trkpt lat="60" lon="24"><ele>102</ele></trkpt></trkseg><trkseg><trkpt lat="60" lon="24"><ele>104</ele></trkpt><trkpt lat="60" lon="24"><ele>106</ele></trkpt></trkseg></trk></gpx>',
      ),
      "separate-segments.gpx",
      "3".repeat(64),
    );
    expect(calculateStatistics(separateSegments)).toMatchObject({
      elevationGain: 0,
      elevationLoss: 0,
    });
  });
});

describe("RDF serialization", () => {
  it("uses rdf:type, supplies statistic types, and gives every quantitative value a complete unit", async () => {
    const activity: NormalizedActivity = {
      sourceFilename: "ride.gpx",
      sourceHash: "a".repeat(64),
      activityType: "Cycling",
      tracks: [],
      warnings: [],
    };
    const statistics: ActivityStatistics = {
      distanceMeters: 1200,
      movingSeconds: 360,
      averageMovingKmh: 12,
      maximumKmh: 24,
      minimumElevation: 10,
      maximumElevation: 80,
    };
    const turtle = await serializeActivity(
      activity,
      statistics,
      "../../source-files/2026/ride.gpx",
    );
    const quads = new Parser().parse(turtle);

    const instrument = quads.find(
      (quad) =>
        quad.subject.equals(namedNode("#activity")) &&
        quad.predicate.equals(schema("instrument")),
    )?.object;
    expect(instrument).toBeDefined();
    expect(quads).toContainEqual(
      expect.objectContaining({
        subject: instrument,
        predicate: schema("name"),
        object: expect.objectContaining({ value: "Solid Fit Converter" }),
      }),
    );

    expect(
      quads.some(
        (quad) =>
          quad.subject.equals(namedNode("#activity")) &&
          quad.predicate.equals(schema("duration")),
      ),
    ).toBe(false);
    expect(quads).toContainEqual(
      expect.objectContaining({
        subject: instrument,
        predicate: schema("softwareVersion"),
        object: expect.objectContaining({ value: "0.1.0" }),
      }),
    );
    expect(quads).toContainEqual(
      expect.objectContaining({
        subject: namedNode("#maximum-speed"),
        predicate: schema("measurementTechnique"),
        object: expect.objectContaining({
          value:
            "Maximum validated two-second centred rolling speed from GPX track points",
        }),
      }),
    );

    const rdfClasses = [
      "ExerciseAction",
      "Observation",
      "QuantitativeValue",
      "MediaObject",
    ].map(schema);
    const classAssertions = quads.filter((quad) =>
      rdfClasses.some((rdfClass) => quad.object.equals(rdfClass)),
    );
    expect(classAssertions).not.toHaveLength(0);
    expect(
      classAssertions.every((quad) => quad.predicate.equals(RDF_TYPE)),
    ).toBe(true);
    expect(quads).toContainEqual(
      expect.objectContaining({
        subject: namedNode("#activity"),
        predicate: RDF_TYPE,
        object: schema("ExerciseAction"),
      }),
    );

    for (const [id, type] of [
      ["average-speed", "Average"],
      ["maximum-speed", "Maximum"],
      ["minimum-elevation", "Minimum"],
      ["maximum-elevation", "Maximum"],
    ]) {
      expect(quads).toContainEqual(
        expect.objectContaining({
          subject: namedNode(`#${id}`),
          predicate: schema("statType"),
          object: expect.objectContaining({ value: type }),
        }),
      );
    }

    const quantitativeValues = quads
      .filter(
        (quad) =>
          quad.predicate.equals(RDF_TYPE) &&
          quad.object.equals(schema("QuantitativeValue")),
      )
      .map((quad) => quad.subject);
    expect(quantitativeValues).not.toHaveLength(0);
    for (const quantitativeValue of quantitativeValues) {
      expect(quads).toContainEqual(
        expect.objectContaining({
          subject: quantitativeValue,
          predicate: schema("unitCode"),
        }),
      );
      expect(quads).toContainEqual(
        expect.objectContaining({
          subject: quantitativeValue,
          predicate: schema("unitText"),
        }),
      );
    }
  });
  it("retains GPX timestamp precision and serializes numeric values as numeric RDF literals", async () => {
    const activity = parseGpx(
      new TextEncoder().encode(
        `<gpx><trk><trkseg><trkpt lat="60.123456789" lon="24"><time>2026-07-14T10:11:00Z</time></trkpt><trkpt lat="60.123456789" lon="24.001"><time>2026-07-14T10:11:06Z</time></trkpt></trkseg></trk></gpx>`,
      ),
      "precision.gpx",
      "f".repeat(64),
    );
    const statistics = calculateStatistics(activity);
    const turtle = await serializeActivity(
      activity,
      statistics,
      "../../source-files/2026/precision.gpx",
    );
    const quads = new Parser().parse(turtle);
    const startTime = quads.find(
      (quad) =>
        quad.subject.equals(namedNode("#activity")) &&
        quad.predicate.equals(schema("startTime")),
    )?.object;
    expect(startTime?.termType).toBe("Literal");
    if (startTime?.termType !== "Literal")
      throw new Error("Expected a date literal");
    expect(startTime.value).toBe("2026-07-14T10:11:00Z");
    expect(startTime.datatype.value).toBe(
      "http://www.w3.org/2001/XMLSchema#dateTime",
    );
    const latitude = quads.find((quad) =>
      quad.predicate.equals(schema("latitude")),
    )?.object;
    expect(latitude?.termType).toBe("Literal");
    if (latitude?.termType !== "Literal")
      throw new Error("Expected a numeric literal");
    expect(latitude.value).toBe("60.123456789");
    expect(latitude.datatype.value).not.toBe(
      "http://www.w3.org/2001/XMLSchema#string",
    );

    const distance = quads.find(
      (quad) =>
        quad.subject.equals(namedNode("#activity")) &&
        quad.predicate.equals(schema("distance")),
    )?.object;
    const distanceValue = distance
      ? quads.find(
          (quad) =>
            quad.subject.equals(distance) &&
            quad.predicate.equals(schema("value")),
        )?.object
      : undefined;
    expect(distanceValue?.termType).toBe("Literal");
    if (distanceValue?.termType !== "Literal")
      throw new Error("Expected a quantitative numeric literal");
    expect(distanceValue.datatype.value).toBe(
      "http://www.w3.org/2001/XMLSchema#decimal",
    );
    expect(distanceValue.value).toBe(String(statistics.distanceMeters / 1000));
    expect(Number(distanceValue.value)).toBeCloseTo(
      statistics.distanceMeters / 1000,
    );
    expect(turtle).toContain(`schema:value ${distanceValue.value}`);
  });
});

describe("import feedback", () => {
  it("explains why an invalid GPX has no usable points", () => {
    expect(() =>
      parseGpx(
        new TextEncoder().encode(
          '<gpx><trk><trkseg><trkpt lat="200" lon="24"/></trkseg></trk></gpx>',
        ),
        "bad.gpx",
        "b".repeat(64),
      ),
    ).toThrow(
      "All 1 track point was rejected because its latitude or longitude is invalid.",
    );
  });
  it("summarizes distinct types and dated years", () => {
    expect(
      summarizeActivities([
        {
          id: "a",
          type: "Cycling",
          distance: 0,
          warnings: 0,
          start: new Date("2024-01-01"),
        },
        {
          id: "b",
          type: "Cycling",
          distance: 0,
          warnings: 0,
          start: new Date("2025-01-01"),
        },
        { id: "c", type: "Running", distance: 0, warnings: 0 },
      ]),
    ).toEqual({ exerciseTypes: 2, yearsCovered: 2 });
  });
});
