import JSZip from "jszip";
import { readInputs } from "../archive/readInputArchive";
import {
  hashSource,
  createActivityId,
  yearFor,
} from "../identifiers/createActivityId";
import { parseGpx } from "../formats/gpx/parseGpx";
import { calculateStatistics } from "../statistics/calculate";
import { serializeActivity } from "../rdf/serializeActivity";
export interface BatchResult {
  blob: Blob;
  filename: string;
  activities: {
    id: string;
    name?: string;
    start?: Date;
    type: string;
    distance: number;
    elapsed?: number;
    moving?: number;
    averageSpeed?: number;
    elevationGain?: number;
    warnings: number;
  }[];
  duplicates: number;
  failures: { path: string; message: string }[];
}
export async function convertBatch(
  files: File[],
  progress: (current: number, total: number, name: string) => void,
  shouldCancel: () => boolean,
): Promise<BatchResult> {
  const inputs = await readInputs(files);
  if (!inputs.length) throw new Error("NO_GPX_FILES");
  const zip = new JSZip(),
    activities: BatchResult["activities"] = [],
    failures: BatchResult["failures"] = [],
    seen = new Set<string>();
  for (let i = 0; i < inputs.length; i++) {
    if (shouldCancel()) throw new Error("CANCELLED");
    const input = inputs[i];
    progress(i, inputs.length, input.path);
    try {
      const hash = await hashSource(input.bytes);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const a = parseGpx(input.bytes, input.path, hash),
        s = calculateStatistics(a),
        id = createActivityId(hash, s.startTime),
        year = yearFor(s.startTime),
        source = `source-files/${year}/${id}.gpx`,
        rdf = `activities/${year}/${id}.ttl`;
      zip.file(`fitness/${source}`, input.bytes);
      zip.file(
        `fitness/${rdf}`,
        await serializeActivity(a, s, `../../${source}`),
      );
      activities.push({
        id,
        name: a.name,
        start: s.startTime,
        type: a.activityType,
        distance: s.distanceMeters,
        elapsed: s.elapsedSeconds,
        moving: s.movingSeconds,
        averageSpeed: s.averageMovingKmh,
        elevationGain: s.elevationGain,
        warnings: a.warnings.length,
      });
    } catch (error) {
      failures.push({
        path: input.path,
        message: error instanceof Error ? error.message : "Conversion failed",
      });
    }
  }
  const manifest = {
    format: "solid-fit-export",
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    converter: { name: "Solid Fit Converter", version: "0.1.0" },
    configuration: {
      minimumMovingSpeedMetersPerSecond: 0.5,
      maximumMovingGapSeconds: 30,
      elevationNoiseThresholdMeters: 3,
      maximumSpeedWindowSeconds: 5,
    },
    summary: {
      inputFiles: inputs.length,
      converted: activities.length,
      duplicates: inputs.length - seen.size,
      failed: failures.length,
    },
    activities,
    duplicates: [],
    failures,
  };
  zip.file("fitness/manifest.json", JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: "blob" });
  return {
    blob,
    filename: `solid-fit-export-${new Date().toISOString().replace(/[-:]/g, "").replace(".000", "")}.zip`,
    activities,
    duplicates: inputs.length - seen.size,
    failures,
  };
}
