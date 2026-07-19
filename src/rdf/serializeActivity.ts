import { DataFactory, Writer } from "n3";
import packageJson from "../../package.json";
import type { ActivityStatistics, NormalizedActivity } from "../model/activity";

const { blankNode, literal, namedNode, quad } = DataFactory;
const SCHEMA = "https://schema.org/";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const schema = (value: string) => namedNode(SCHEMA + value);
const rdfType = namedNode(RDF + "type");

interface Unit {
  code: string;
  text: string;
}

const UNITS = {
  kilometres: { code: "KMT", text: "km" },
  kilometresPerHour: { code: "KMH", text: "km/h" },
  metres: { code: "MTR", text: "m" },
  seconds: { code: "SEC", text: "seconds" },
} satisfies Record<string, Unit>;

export async function serializeActivity(
  activity: NormalizedActivity,
  stats: ActivityStatistics,
  sourceLink: string,
): Promise<string> {
  const writer = new Writer({
    prefixes: { schema: SCHEMA, rdf: RDF, xsd: XSD },
  });
  const activityNode = namedNode("#activity");

  writer.addQuad(quad(activityNode, rdfType, schema("ExerciseAction")));
  writer.addQuad(
    quad(activityNode, schema("exerciseType"), literal(activity.activityType)),
  );
  const instrument = blankNode();
  writer.addQuads([
    quad(activityNode, schema("instrument"), instrument),
    quad(instrument, rdfType, schema("SoftwareApplication")),
    quad(instrument, schema("name"), literal("Solid Fit Converter")),
    quad(instrument, schema("softwareVersion"), literal(packageJson.version)),
  ]);
  if (activity.name)
    writer.addQuad(quad(activityNode, schema("name"), literal(activity.name)));

  for (const [property, point] of [
    ["fromLocation", stats.start],
    ["toLocation", stats.end],
  ] as const) {
    if (!point) continue;
    const place = blankNode();
    const geo = blankNode();
    writer.addQuads([
      quad(activityNode, schema(property), place),
      quad(place, rdfType, schema("Place")),
      quad(place, schema("geo"), geo),
      quad(geo, rdfType, schema("GeoCoordinates")),
      quad(geo, schema("latitude"), literal(point.latitude)),
      quad(geo, schema("longitude"), literal(point.longitude)),
    ]);
  }

  for (const [property, endpoint, time, timeText] of [
    ["startTime", stats.start, stats.startTime, stats.startTimeText],
    ["endTime", stats.end, stats.endTime, stats.endTimeText],
  ] as const) {
    const timestamp = endpoint?.time ?? time;
    if (timestamp)
      writer.addQuad(
        quad(
          activityNode,
          schema(property),
          literal(
            endpoint?.timeText ?? timeText ?? timestamp.toISOString(),
            namedNode(XSD + "dateTime"),
          ),
        ),
      );
  }
  if (stats.elapsedSeconds !== undefined) {
    writer.addQuad(
      quad(
        activityNode,
        schema("duration"),
        literal(`PT${Math.round(stats.elapsedSeconds)}S`, schema("Duration")),
      ),
    );
  }

  const distance = blankNode();
  addQuantitativeValue(
    writer,
    distance,
    stats.distanceMeters / 1000,
    UNITS.kilometres,
  );
  writer.addQuad(quad(activityNode, schema("distance"), distance));

  const media = blankNode();
  writer.addQuads([
    quad(activityNode, schema("subjectOf"), media),
    quad(media, rdfType, schema("MediaObject")),
    quad(media, schema("contentUrl"), namedNode(sourceLink)),
    quad(media, schema("encodingFormat"), literal("application/gpx+xml")),
  ]);

  const addObservation = (
    id: string,
    property: string,
    value: number,
    unit: Unit,
    statType?: string,
    measurementTechnique?: string,
  ) => {
    const observation = namedNode(`#${id}`);
    const quantitativeValue = blankNode();
    writer.addQuads([
      quad(activityNode, schema("result"), observation),
      quad(observation, rdfType, schema("Observation")),
      quad(observation, schema("observationAbout"), activityNode),
      quad(observation, schema("measuredProperty"), literal(property)),
      quad(observation, schema("value"), quantitativeValue),
    ]);
    if (statType)
      writer.addQuad(quad(observation, schema("statType"), literal(statType)));
    if (measurementTechnique)
      writer.addQuad(
        quad(
          observation,
          schema("measurementTechnique"),
          literal(measurementTechnique),
        ),
      );
    addQuantitativeValue(writer, quantitativeValue, value, unit);
  };

  if (stats.movingSeconds !== undefined)
    addObservation(
      "moving-time",
      "MovingTime",
      stats.movingSeconds,
      UNITS.seconds,
      undefined,
      "Calculated from GPX track point timestamps",
    );
  if (stats.averageMovingKmh !== undefined)
    addObservation(
      "average-speed",
      "Speed",
      stats.averageMovingKmh,
      UNITS.kilometresPerHour,
      "Average",
      "Calculated from GPX track points and moving time",
    );
  if (stats.maximumKmh !== undefined)
    addObservation(
      "maximum-speed",
      "Speed",
      stats.maximumKmh,
      UNITS.kilometresPerHour,
      "Maximum",
      "Calculated from GPX track points using a rolling time window",
    );
  if (stats.minimumElevation !== undefined)
    addObservation(
      "minimum-elevation",
      "Elevation",
      stats.minimumElevation,
      UNITS.metres,
      "Minimum",
      "Calculated from GPX elevation samples",
    );
  if (stats.maximumElevation !== undefined)
    addObservation(
      "maximum-elevation",
      "Elevation",
      stats.maximumElevation,
      UNITS.metres,
      "Maximum",
      "Calculated from GPX elevation samples",
    );
  if (stats.elevationGain !== undefined)
    addObservation(
      "elevation-gain",
      "ElevationGain",
      stats.elevationGain,
      UNITS.metres,
      undefined,
      "Calculated from GPX elevation samples",
    );
  if (stats.elevationLoss !== undefined)
    addObservation(
      "elevation-loss",
      "ElevationLoss",
      stats.elevationLoss,
      UNITS.metres,
      undefined,
      "Calculated from GPX elevation samples",
    );
  if (stats.bounds) {
    const bounds = namedNode("#bounds");
    const geoShape = blankNode();
    const { minLatitude, minLongitude, maxLatitude, maxLongitude } =
      stats.bounds;
    writer.addQuads([
      quad(activityNode, schema("result"), bounds),
      quad(bounds, rdfType, schema("Observation")),
      quad(bounds, schema("observationAbout"), activityNode),
      quad(bounds, schema("measuredProperty"), literal("GeographicalBounds")),
      quad(
        bounds,
        schema("measurementTechnique"),
        literal("Calculated from GPX track points"),
      ),
      quad(bounds, schema("value"), geoShape),
      quad(geoShape, rdfType, schema("GeoShape")),
      quad(
        geoShape,
        schema("box"),
        literal(
          `${minLatitude} ${minLongitude} ${maxLatitude} ${maxLongitude}`,
        ),
      ),
    ]);
  }

  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

function addQuantitativeValue(
  writer: Writer,
  node: ReturnType<typeof blankNode>,
  value: number,
  unit: Unit,
): void {
  writer.addQuads([
    quad(node, rdfType, schema("QuantitativeValue")),
    quad(node, schema("value"), literal(value)),
    quad(node, schema("unitCode"), literal(unit.code)),
    quad(node, schema("unitText"), literal(unit.text)),
  ]);
}
