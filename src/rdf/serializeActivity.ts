import { DataFactory, Writer } from "n3";
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
  if (activity.name)
    writer.addQuad(quad(activityNode, schema("name"), literal(activity.name)));

  for (const [property, date] of [
    ["startTime", stats.startTime],
    ["endTime", stats.endTime],
  ] as const) {
    if (date)
      writer.addQuad(
        quad(
          activityNode,
          schema(property),
          literal(date.toISOString(), namedNode(XSD + "dateTime")),
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
    addQuantitativeValue(writer, quantitativeValue, value, unit);
  };

  if (stats.movingSeconds !== undefined)
    addObservation(
      "moving-time",
      "MovingTime",
      stats.movingSeconds,
      UNITS.seconds,
    );
  if (stats.averageMovingKmh !== undefined)
    addObservation(
      "average-speed",
      "Speed",
      stats.averageMovingKmh,
      UNITS.kilometresPerHour,
      "Average",
    );
  if (stats.maximumKmh !== undefined)
    addObservation(
      "maximum-speed",
      "Speed",
      stats.maximumKmh,
      UNITS.kilometresPerHour,
      "Maximum",
    );
  if (stats.minimumElevation !== undefined)
    addObservation(
      "minimum-elevation",
      "Elevation",
      stats.minimumElevation,
      UNITS.metres,
      "Minimum",
    );
  if (stats.maximumElevation !== undefined)
    addObservation(
      "maximum-elevation",
      "Elevation",
      stats.maximumElevation,
      UNITS.metres,
      "Maximum",
    );

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
