import { describe, it, expect } from "vitest";
import { DataFactory, Parser } from "n3";
import { distanceBetween, calculateStatistics } from "../statistics/calculate";
import { createActivityId } from "../identifiers/createActivityId";
import { parseGpx } from "../formats/gpx/parseGpx";
import { serializeActivity } from "../rdf/serializeActivity";
import type { ActivityStatistics, NormalizedActivity } from "../model/activity";
import { summarizeActivities } from "../app/importSummary";

const { namedNode } = DataFactory;
const SCHEMA = "https://schema.org/";
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const schema = (term: string) => namedNode(SCHEMA + term);

describe("conversion core", () => {
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
    expect(turtle).not.toContain("ElevationGain");
    expect(turtle).not.toContain("ElevationLoss");
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

    expect(turtle).not.toContain("xsd:type");
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
