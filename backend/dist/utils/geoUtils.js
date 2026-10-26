"use strict";
/**
 * Geolocation Utilities
 * Implements the Haversine formula for computing great-circle distances
 * between two GPS coordinates. Returns distance in meters.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.haversineDistance = haversineDistance;
/**
 * Haversine Distance Formula.
 * Accurately computes the shortest over-the-surface distance between
 * two GPS coordinates on Earth.
 *
 * @param lat1 - Latitude of point 1 (degrees)
 * @param lon1 - Longitude of point 1 (degrees)
 * @param lat2 - Latitude of point 2 (degrees)
 * @param lon2 - Longitude of point 2 (degrees)
 * @returns Distance in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const EARTH_RADIUS_METERS = 6_371_000; // Mean radius of Earth in meters
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const Δφ = toRadians(lat2 - lat1);
    const Δλ = toRadians(lon2 - lon1);
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}
