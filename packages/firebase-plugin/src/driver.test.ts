import { describe, it, expect, vi, beforeEach } from "vitest";
import { FirebaseDriver, initializeFirebaseApp } from "./driver.js";

// --- Hoisted mocks (vi.mock factory cannot reference top-level variables) ---

const {
  mockDocGet, mockDocListCollections,
  mockCollectionGet, mockCountGet, mockCollectionGroupGet,
  queryChain,
  mockFirestore,
  mockAuth,
  mockBucketFile, mockBucket, mockStorage,
  mockDbRef, mockDatabase,
  mockApp,
  MockTimestamp, MockGeoPoint, MockDocumentReference,
} = vi.hoisted(() => {
  const mockDocGet = vi.fn();
  const mockDocListCollections = vi.fn();
  const mockCollectionGet = vi.fn();
  const mockCountGet = vi.fn();
  const mockCollectionGroupGet = vi.fn();

  const queryChain: Record<string, ReturnType<typeof vi.fn>> = {};
  queryChain.where = vi.fn().mockReturnThis();
  queryChain.orderBy = vi.fn().mockReturnThis();
  queryChain.limit = vi.fn().mockReturnThis();
  queryChain.select = vi.fn().mockReturnThis();
  queryChain.count = vi.fn().mockReturnValue({ get: mockCountGet });
  queryChain.get = mockCollectionGet;

  const mockFirestore = {
    doc: vi.fn().mockReturnValue({
      get: mockDocGet,
      listCollections: mockDocListCollections,
    }),
    collection: vi.fn().mockReturnValue(queryChain),
    collectionGroup: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ get: mockCollectionGroupGet }),
          get: mockCollectionGroupGet,
        }),
        limit: vi.fn().mockReturnValue({ get: mockCollectionGroupGet }),
        get: mockCollectionGroupGet,
      }),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ get: mockCollectionGroupGet }),
        get: mockCollectionGroupGet,
      }),
      limit: vi.fn().mockReturnValue({ get: mockCollectionGroupGet }),
      get: mockCollectionGroupGet,
    }),
  };

  const mockAuth = {
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    listUsers: vi.fn(),
  };

  const mockBucketFile = {
    exists: vi.fn(),
    getMetadata: vi.fn(),
  };
  const mockBucket = {
    file: vi.fn().mockReturnValue(mockBucketFile),
    getFiles: vi.fn(),
  };
  const mockStorage = {
    bucket: vi.fn().mockReturnValue(mockBucket),
  };

  const mockDbRef = {
    get: vi.fn(),
    orderByChild: vi.fn().mockReturnValue({
      equalTo: vi.fn().mockReturnValue({ get: vi.fn() }),
      get: vi.fn(),
    }),
    orderByKey: vi.fn().mockReturnValue({ get: vi.fn() }),
    orderByValue: vi.fn().mockReturnValue({ get: vi.fn() }),
  };
  const mockDatabase = {
    ref: vi.fn().mockReturnValue(mockDbRef),
  };

  const mockApp = {
    firestore: vi.fn().mockReturnValue(mockFirestore),
    auth: vi.fn().mockReturnValue(mockAuth),
    storage: vi.fn().mockReturnValue(mockStorage),
    database: vi.fn().mockReturnValue(mockDatabase),
  };

  class MockTimestamp {
    constructor(private _seconds: number, private _nanoseconds: number) {}
    toDate() { return new Date(this._seconds * 1000); }
  }
  class MockGeoPoint {
    constructor(public latitude: number, public longitude: number) {}
  }
  class MockDocumentReference {
    constructor(public path: string) {}
  }

  return {
    mockDocGet, mockDocListCollections,
    mockCollectionGet, mockCountGet, mockCollectionGroupGet,
    queryChain,
    mockFirestore,
    mockAuth,
    mockBucketFile, mockBucket, mockStorage,
    mockDbRef, mockDatabase,
    mockApp,
    MockTimestamp, MockGeoPoint, MockDocumentReference,
  };
});

vi.mock("firebase-admin", () => {
  return {
    default: {
      initializeApp: vi.fn().mockReturnValue(mockApp),
      credential: { cert: vi.fn() },
      firestore: Object.assign(() => mockFirestore, {
        Timestamp: MockTimestamp,
        GeoPoint: MockGeoPoint,
        DocumentReference: MockDocumentReference,
      }),
    },
  };
});

// --- Test helpers ---

function makeStep(overrides?: Record<string, unknown>) {
  return {
    id: "stp1",
    step_key: "check_firebase",
    action: "firebase",
    config: {
      operation: "get_document",
      params: { path: "users/user123" },
    },
    sort_order: 0,
    ...overrides,
  };
}

describe("FirebaseDriver", () => {
  let driver: FirebaseDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new FirebaseDriver(mockApp as never);

    // Re-wire query chain after clearAllMocks
    queryChain.where = vi.fn().mockReturnThis();
    queryChain.orderBy = vi.fn().mockReturnThis();
    queryChain.limit = vi.fn().mockReturnThis();
    queryChain.select = vi.fn().mockReturnThis();
    queryChain.count = vi.fn().mockReturnValue({ get: mockCountGet });
    queryChain.get = mockCollectionGet;

    mockFirestore.doc.mockReturnValue({
      get: mockDocGet,
      listCollections: mockDocListCollections,
    });
    mockFirestore.collection.mockReturnValue(queryChain);
  });

  // --- Firestore: get_document ---

  it("executes get_document and returns passed", async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: "user123",
      data: () => ({ name: "Alice", status: "active" }),
    });

    const result = await driver.execute(makeStep() as never, {});

    expect(result.status).toBe("passed");
    expect(result.response?.body).toContain("Alice");
  });

  it("returns null for non-existent document", async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const step = makeStep({
      assertions: [{ type: "firebase_document_exists", exists: true }],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("failed");
    expect(result.assertionResults![0].passed).toBe(false);
  });

  it("evaluates firebase_field assertions", async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: "user123",
      data: () => ({ status: "active" }),
    });

    const step = makeStep({
      assertions: [
        { type: "firebase_field", path: "status", expected: "active" },
      ],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(result.assertionResults).toHaveLength(1);
    expect(result.assertionResults![0].passed).toBe(true);
  });

  it("returns failed when assertion does not match", async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: "user123",
      data: () => ({ status: "inactive" }),
    });

    const step = makeStep({
      assertions: [
        { type: "firebase_field", path: "status", expected: "active" },
      ],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("failed");
    expect(result.assertionResults![0].passed).toBe(false);
    expect(result.assertionResults![0].actual).toBe("inactive");
  });

  it("extracts values from response", async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: "user123",
      data: () => ({ status: "active", email: "alice@example.com" }),
    });

    const step = makeStep({
      extract: { user_status: "$.status", user_email: "$.email" },
    });
    const result = await driver.execute(step as never, {});

    expect(result.extractedValues).toEqual({
      user_status: "active",
      user_email: "alice@example.com",
    });
  });

  // --- Firestore: list_documents ---

  it("executes list_documents with filters", async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [
        { id: "doc1", data: () => ({ status: "active" }), ref: { path: "orders/doc1" } },
        { id: "doc2", data: () => ({ status: "active" }), ref: { path: "orders/doc2" } },
      ],
    });

    const step = makeStep({
      config: {
        operation: "list_documents",
        params: { collection: "orders" },
        filters: [{ field: "status", operator: "eq", value: "active" }],
        limit: 10,
      },
      assertions: [
        { type: "firebase_count", expected: 2, condition: "equals" },
      ],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(mockFirestore.collection).toHaveBeenCalledWith("orders");
    expect(queryChain.where).toHaveBeenCalledWith("status", "==", "active");
  });

  // --- Firestore: count_documents ---

  it("executes count_documents", async () => {
    mockCountGet.mockResolvedValue({ data: () => ({ count: 42 }) });

    const step = makeStep({
      config: {
        operation: "count_documents",
        params: { collection: "orders" },
      },
      assertions: [
        { type: "firebase_count", expected: 42, condition: "equals" },
      ],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
  });

  // --- Firestore: collection_group_query ---

  it("executes collection_group_query", async () => {
    mockCollectionGroupGet.mockResolvedValue({
      docs: [
        { id: "order1", data: () => ({ status: "pending" }), ref: { path: "users/u1/orders/order1" } },
      ],
    });

    const step = makeStep({
      config: {
        operation: "collection_group_query",
        params: { collection_id: "orders" },
        limit: 10,
      },
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(mockFirestore.collectionGroup).toHaveBeenCalledWith("orders");
  });

  // --- Auth ---

  it("executes get_user_by_uid", async () => {
    mockAuth.getUser.mockResolvedValue({
      toJSON: () => ({ uid: "uid123", email: "alice@example.com", displayName: "Alice" }),
    });

    const step = makeStep({
      config: { operation: "get_user_by_uid", params: { uid: "uid123" } },
      assertions: [
        { type: "firebase_field", path: "displayName", expected: "Alice" },
      ],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(mockAuth.getUser).toHaveBeenCalledWith("uid123");
  });

  it("executes get_user_by_email", async () => {
    mockAuth.getUserByEmail.mockResolvedValue({
      toJSON: () => ({ uid: "uid123", email: "alice@example.com" }),
    });

    const step = makeStep({
      config: { operation: "get_user_by_email", params: { email: "alice@example.com" } },
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(mockAuth.getUserByEmail).toHaveBeenCalledWith("alice@example.com");
  });

  it("executes get_user_by_phone", async () => {
    mockAuth.getUserByPhoneNumber.mockResolvedValue({
      toJSON: () => ({ uid: "uid123", phoneNumber: "+81901234567" }),
    });

    const step = makeStep({
      config: { operation: "get_user_by_phone", params: { phone: "+81901234567" } },
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(mockAuth.getUserByPhoneNumber).toHaveBeenCalledWith("+81901234567");
  });

  it("returns null when auth user not found", async () => {
    const err = new Error("User not found");
    (err as unknown as { code: string }).code = "auth/user-not-found";
    mockAuth.getUser.mockRejectedValue(err);

    const step = makeStep({
      config: { operation: "get_user_by_uid", params: { uid: "nonexistent" } },
      assertions: [{ type: "firebase_document_exists", exists: false }],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
  });

  it("executes list_users", async () => {
    mockAuth.listUsers.mockResolvedValue({
      users: [
        { toJSON: () => ({ uid: "u1" }) },
        { toJSON: () => ({ uid: "u2" }) },
      ],
    });

    const step = makeStep({
      config: { operation: "list_users", limit: 10 },
      assertions: [{ type: "firebase_count", expected: 2, condition: "equals" }],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
  });

  // --- Storage ---

  it("executes file_exists — file exists", async () => {
    mockBucketFile.exists.mockResolvedValue([true]);

    const step = makeStep({
      config: { operation: "file_exists", params: { path: "avatars/user123.png" } },
      assertions: [{ type: "firebase_document_exists", exists: true }],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
  });

  it("executes file_exists — file does not exist", async () => {
    mockBucketFile.exists.mockResolvedValue([false]);

    const step = makeStep({
      config: { operation: "file_exists", params: { path: "avatars/nonexistent.png" } },
      assertions: [{ type: "firebase_document_exists", exists: false }],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
  });

  it("executes get_file_metadata", async () => {
    mockBucketFile.getMetadata.mockResolvedValue([{
      contentType: "image/png",
      size: 12345,
    }]);

    const step = makeStep({
      config: { operation: "get_file_metadata", params: { path: "avatars/user123.png" } },
      assertions: [
        { type: "firebase_field", path: "contentType", expected: "image/png" },
      ],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
  });

  it("executes list_files", async () => {
    mockBucket.getFiles.mockResolvedValue([[
      { name: "avatars/user1.png", metadata: { contentType: "image/png" } },
      { name: "avatars/user2.png", metadata: { contentType: "image/png" } },
    ]]);

    const step = makeStep({
      config: { operation: "list_files", params: { prefix: "avatars/" }, limit: 10 },
      assertions: [{ type: "firebase_count", expected: 2, condition: "equals" }],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
  });

  // --- Realtime Database ---

  it("executes get_node", async () => {
    mockDbRef.get.mockResolvedValue({
      exists: () => true,
      val: () => ({ online: true, lastSeen: 1711234567 }),
    });

    const step = makeStep({
      config: { operation: "get_node", params: { path: "presence/user123" } },
      assertions: [
        { type: "firebase_field", path: "online", expected: "true" },
      ],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(mockDatabase.ref).toHaveBeenCalledWith("presence/user123");
  });

  it("returns null for non-existent node", async () => {
    mockDbRef.get.mockResolvedValue({
      exists: () => false,
      val: () => null,
    });

    const step = makeStep({
      config: { operation: "get_node", params: { path: "presence/nonexistent" } },
      assertions: [{ type: "firebase_document_exists", exists: false }],
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
  });

  // --- Error handling ---

  it("returns error for unknown operation", async () => {
    const step = makeStep({
      config: { operation: "unknown_op", params: {} },
    });
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("Unknown Firebase operation");
  });

  it("returns error when Firebase API fails", async () => {
    mockDocGet.mockRejectedValue(new Error("Permission denied"));

    const result = await driver.execute(makeStep() as never, {});

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("Permission denied");
  });
});

describe("initializeFirebaseApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  });

  it("initializes in emulator mode", async () => {
    const admin = await import("firebase-admin");

    const variables: Record<string, string> = {
      firebase_emulator: "true",
      firebase_project_id: "demo-test",
      firebase_firestore_emulator_host: "localhost:8080",
      firebase_auth_emulator_host: "localhost:9099",
    };
    const config = {
      emulator_variable: "firebase_emulator",
      project_id_variable: "firebase_project_id",
      firestore_emulator_host_variable: "firebase_firestore_emulator_host",
      auth_emulator_host_variable: "firebase_auth_emulator_host",
      storage_emulator_host_variable: "firebase_storage_emulator_host",
      database_emulator_host_variable: "firebase_database_emulator_host",
    } as never;

    initializeFirebaseApp(variables, config);

    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe("localhost:8080");
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe("localhost:9099");
    expect(admin.default.initializeApp).toHaveBeenCalled();
  });

  it("initializes with service account credentials", async () => {
    const admin = await import("firebase-admin");

    const variables: Record<string, string> = {
      firebase_project_id: "my-project",
      firebase_client_email: "sa@my-project.iam.gserviceaccount.com",
      firebase_private_key: "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----",
      firebase_emulator: "false",
    };
    const config = {
      project_id_variable: "firebase_project_id",
      client_email_variable: "firebase_client_email",
      private_key_variable: "firebase_private_key",
      emulator_variable: "firebase_emulator",
      firestore_emulator_host_variable: "firebase_firestore_emulator_host",
      auth_emulator_host_variable: "firebase_auth_emulator_host",
      storage_emulator_host_variable: "firebase_storage_emulator_host",
      database_emulator_host_variable: "firebase_database_emulator_host",
    } as never;

    initializeFirebaseApp(variables, config);

    expect(admin.default.credential.cert).toHaveBeenCalled();
    expect(admin.default.initializeApp).toHaveBeenCalled();
  });

  it("throws when credentials are missing", () => {
    const variables: Record<string, string> = {
      firebase_emulator: "false",
    };
    const config = {
      project_id_variable: "firebase_project_id",
      client_email_variable: "firebase_client_email",
      private_key_variable: "firebase_private_key",
      emulator_variable: "firebase_emulator",
      firestore_emulator_host_variable: "firebase_firestore_emulator_host",
      auth_emulator_host_variable: "firebase_auth_emulator_host",
      storage_emulator_host_variable: "firebase_storage_emulator_host",
      database_emulator_host_variable: "firebase_database_emulator_host",
    } as never;

    expect(() => initializeFirebaseApp(variables, config)).toThrow("Firebase credentials are required");
  });
});
