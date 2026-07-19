export type ActivityType =
  | "Cycling"
  | "Running"
  | "Walking"
  | "Hiking"
  | "Swimming"
  | "Unknown";
export interface ConversionWarning {
  code: string;
  message: string;
}
export interface NormalizedTrackPoint {
  latitude: number;
  longitude: number;
  elevationMeters?: number;
  time?: Date;
  timeText?: string;
  heartRateBpm?: number;
  cadenceRpm?: number;
}
export interface NormalizedTrackSegment {
  points: NormalizedTrackPoint[];
}
export interface NormalizedTrack {
  name?: string;
  segments: NormalizedTrackSegment[];
}
export interface NormalizedActivity {
  sourceFilename: string;
  sourceHash: string;
  name?: string;
  activityType: ActivityType;
  tracks: NormalizedTrack[];
  warnings: ConversionWarning[];
}
export interface ActivityStatistics {
  start?: NormalizedTrackPoint;
  end?: NormalizedTrackPoint;
  startTime?: Date;
  endTime?: Date;
  elapsedSeconds?: number;
  movingSeconds?: number;
  distanceMeters: number;
  averageMovingKmh?: number;
  maximumKmh?: number;
  minimumElevation?: number;
  maximumElevation?: number;
  elevationGain?: number;
  elevationLoss?: number;
  bounds?: {
    minLatitude: number;
    minLongitude: number;
    maxLatitude: number;
    maxLongitude: number;
  };
  heartRate?: { min: number; max: number; average: number };
}
