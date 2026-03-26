import { describe, it, expect, vi } from "vitest";

const { MockTimestamp, MockGeoPoint, MockDocumentReference } = vi.hoisted(() => {
  class MockTimestamp {
    constructor(
      private _seconds: number,
      private _nanoseconds: number,
    ) {}
    toDate() {
      return new Date(this._seconds * 1000 + this._nanoseconds / 1000000);
    }
  }

  class MockGeoPoint {
    constructor(
      public latitude: number,
      public longitude: number,
    ) {}
  }

  class MockDocumentReference {
    constructor(public path: string) {}
  }

  return { MockTimestamp, MockGeoPoint, MockDocumentReference };
});

vi.mock("firebase-admin", () => {
  return {
    default: {
      firestore: Object.assign(() => ({}), {
        Timestamp: MockTimestamp,
        GeoPoint: MockGeoPoint,
        DocumentReference: MockDocumentReference,
      }),
    },
  };
});

import { convertFirestoreTypes } from "./convert.js";

describe("convertFirestoreTypes", () => {
  describe("Timestamp", () => {
    it("converts Timestamp to ISO string", () => {
      const ts = new MockTimestamp(1711234567, 0);
      const result = convertFirestoreTypes(ts);
      expect(typeof result).toBe("string");
      expect(result).toBe(ts.toDate().toISOString());
    });
  });

  describe("GeoPoint", () => {
    it("converts GeoPoint to latitude/longitude object", () => {
      const geo = new MockGeoPoint(35.68, 139.76);
      const result = convertFirestoreTypes(geo);
      expect(result).toEqual({ latitude: 35.68, longitude: 139.76 });
    });

    it("handles negative coordinates", () => {
      const geo = new MockGeoPoint(-33.87, 151.21);
      const result = convertFirestoreTypes(geo);
      expect(result).toEqual({ latitude: -33.87, longitude: 151.21 });
    });
  });

  describe("DocumentReference", () => {
    it("converts DocumentReference to path string", () => {
      const ref = new MockDocumentReference("users/abc123");
      const result = convertFirestoreTypes(ref);
      expect(result).toBe("users/abc123");
    });

    it("handles nested paths", () => {
      const ref = new MockDocumentReference("teams/t1/members/m1");
      const result = convertFirestoreTypes(ref);
      expect(result).toBe("teams/t1/members/m1");
    });
  });

  describe("Bytes", () => {
    it("converts Buffer to Base64", () => {
      const buf = Buffer.from("Hello");
      const result = convertFirestoreTypes(buf);
      expect(result).toBe("SGVsbG8=");
    });

    it("converts Uint8Array to Base64", () => {
      const arr = new Uint8Array([72, 101]);
      const result = convertFirestoreTypes(arr);
      expect(result).toBe("SGU=");
    });
  });

  describe("recursive conversion", () => {
    it("converts nested objects", () => {
      const data = {
        user: { createdAt: new MockTimestamp(1711234567, 0) },
      };
      const result = convertFirestoreTypes(data) as Record<string, Record<string, string>>;
      expect(typeof result.user.createdAt).toBe("string");
    });

    it("converts arrays of Timestamps", () => {
      const data = [new MockTimestamp(1000, 0), new MockTimestamp(2000, 0)];
      const result = convertFirestoreTypes(data) as string[];
      expect(result).toHaveLength(2);
      expect(typeof result[0]).toBe("string");
      expect(typeof result[1]).toBe("string");
    });

    it("converts mixed-type objects", () => {
      const data = {
        ts: new MockTimestamp(1000, 0),
        geo: new MockGeoPoint(35.68, 139.76),
        ref: new MockDocumentReference("users/abc"),
        name: "hello",
        count: 42,
        active: true,
      };
      const result = convertFirestoreTypes(data) as Record<string, unknown>;
      expect(typeof result.ts).toBe("string");
      expect(result.geo).toEqual({ latitude: 35.68, longitude: 139.76 });
      expect(result.ref).toBe("users/abc");
      expect(result.name).toBe("hello");
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
    });

    it("returns primitives as-is", () => {
      expect(convertFirestoreTypes("hello")).toBe("hello");
      expect(convertFirestoreTypes(123)).toBe(123);
      expect(convertFirestoreTypes(true)).toBe(true);
      expect(convertFirestoreTypes(null)).toBe(null);
      expect(convertFirestoreTypes(undefined)).toBe(undefined);
    });

    it("returns empty objects and arrays as-is", () => {
      expect(convertFirestoreTypes({})).toEqual({});
      expect(convertFirestoreTypes([])).toEqual([]);
    });
  });
});
