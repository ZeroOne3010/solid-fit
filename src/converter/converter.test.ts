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
