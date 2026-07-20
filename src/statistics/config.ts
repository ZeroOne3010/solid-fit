/** Internal policy constants for GPX movement and speed calculations. */
export const movementDefaults = {
  /** Enter a possible stop below this speed; exiting requires a higher speed. */
  stopEnterSpeedKmh: 1,
  stopExitSpeedKmh: 2,
  stopMinDurationSeconds: 10,
  stopRadiusMeters: 6,
  stopExitRadiusMeters: 8,
  /** Directional drift beyond this before confirmation is slow movement. */
  stopContinuousMovementMeters: 2,
  maxValidSpeedKmh: 100,
  /** Speeds above this need an overlapping centred-window corroboration. */
  highSpeedCorroborationKmh: 40,
  /** Neighbouring high-speed estimates may differ by at most this fraction. */
  highSpeedCorroborationTolerance: 0.4,
  maxAccelerationKmhPerSecond: 20,
  elevationNoiseThresholdMeters: 3,
} as const;
