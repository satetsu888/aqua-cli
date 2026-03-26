import admin from "firebase-admin";

/**
 * Recursively converts Firestore-specific types to plain JS types
 * that can be used in assertions and JSON serialization.
 *
 * - Timestamp → ISO 8601 string
 * - GeoPoint → { latitude, longitude }
 * - DocumentReference → document path string
 * - Bytes/Buffer → Base64 string
 */
export function convertFirestoreTypes(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (data instanceof admin.firestore.Timestamp) {
    return data.toDate().toISOString();
  }

  if (data instanceof admin.firestore.GeoPoint) {
    return { latitude: data.latitude, longitude: data.longitude };
  }

  if (data instanceof admin.firestore.DocumentReference) {
    return data.path;
  }

  if (data instanceof Buffer || data instanceof Uint8Array) {
    return Buffer.from(data).toString("base64");
  }

  if (Array.isArray(data)) {
    return data.map(convertFirestoreTypes);
  }

  if (typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, convertFirestoreTypes(v)])
    );
  }

  return data;
}
