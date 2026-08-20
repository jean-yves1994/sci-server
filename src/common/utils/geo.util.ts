/**
 * Geospatial helpers for proof-of-presence.
 *
 * Distance is always computed server-side from the property's registered
 * coordinates. A client-supplied distance is worthless: an app that can fake
 * its position can equally fake the arithmetic about it.
 */
const EARTH_RADIUS_M = 6_371_000;

export interface Coordinates { latitude: number; longitude: number }

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres (haversine).
 *
 * Haversine assumes a spherical Earth — accurate to roughly 0.5%, a few metres
 * over the distances involved in confirming somebody stood at a building. That
 * is well inside consumer GPS error, so an ellipsoidal formula would add cost
 * without adding certainty.
 */
export function distanceInMetres(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude));
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function isPlausibleCoordinate(value: Coordinates): boolean {
  const { latitude, longitude } = value;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  // Exactly (0,0) is in the Gulf of Guinea and is nearly always an
  // uninitialised variable rather than a real reading.
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

export type ProximityVerdict = 'AT_PROPERTY' | 'NEARBY' | 'DISTANT' | 'UNVERIFIABLE';

export interface ProximityAssessment {
  verdict: ProximityVerdict;
  distanceM: number | null;
  explanation: string;
}

/**
 * Classifies how close a capture was to the registered property.
 *
 * Produces a verdict for a human to weigh, not a hard block. Registered
 * coordinates are frequently approximate — geocoded from a postal address, or
 * taken at the plot gate rather than the building — so refusing a submission on
 * distance alone would reject honest fieldwork. The reviewer sees the number.
 */
export function assessProximity(
  captured: Coordinates,
  registered: Coordinates | null,
  accuracyM: number | null,
): ProximityAssessment {
  if (!registered) {
    return {
      verdict: 'UNVERIFIABLE',
      distanceM: null,
      explanation: 'The property has no registered coordinates, so the capture cannot be verified.',
    };
  }

  const distanceM = distanceInMetres(captured, registered);
  // A reading accurate to only 500m cannot contradict a 400m discrepancy.
  const tolerance = Math.max(100, accuracyM ?? 0);

  if (distanceM <= tolerance) {
    return {
      verdict: 'AT_PROPERTY',
      distanceM,
      explanation: `Captured ${distanceM}m from the registered location, within the reading's accuracy.`,
    };
  }
  if (distanceM <= 1000) {
    return {
      verdict: 'NEARBY',
      distanceM,
      explanation: `Captured ${distanceM}m away. Registered coordinates are often approximate.`,
    };
  }
  return {
    verdict: 'DISTANT',
    distanceM,
    explanation: `Captured ${(distanceM / 1000).toFixed(1)}km from the registered location. Worth confirming with the inspector.`,
  };
}
