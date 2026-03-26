import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { getJsonPath, extractValues } from "@aquaqa/cli/utils";
import type { Driver, Step, StepResult } from "@aquaqa/cli/plugin";
import type { FirebaseConfig, FirebaseAssertion } from "./schemas.js";
import { evaluateAssertions } from "./assertions.js";
import { convertFirestoreTypes } from "./convert.js";

/** Maps config filter operators to Firestore query operators */
const FIRESTORE_OPERATORS: Record<string, FirebaseFirestore.WhereFilterOp> = {
  eq: "==",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  array_contains: "array-contains",
  array_contains_any: "array-contains-any",
  in: "in",
  not_in: "not-in",
};

export class FirebaseDriver implements Driver {
  private app: admin.app.App;

  constructor(app: admin.app.App) {
    this.app = app;
  }

  async execute(
    step: Step,
    _variables: Record<string, string>,
  ): Promise<StepResult> {
    const config = step.config as FirebaseConfig;
    const startedAt = new Date();

    try {
      let response: unknown;
      let count: number | undefined;

      if (config.poll) {
        const result = await this.pollFirebaseAPI(config);
        response = result.response;
        count = result.count;
      } else {
        const result = await this.callFirebaseAPI(config);
        response = result.response;
        count = result.count;
      }

      const assertions = evaluateAssertions(
        step.assertions as FirebaseAssertion[] | undefined,
        response,
        count,
      );

      const allPassed = assertions.length === 0 || assertions.every((a) => a.passed);

      return {
        stepKey: step.step_key,
        scenarioName: "",
        action: step.action,
        status: allPassed ? "passed" : "failed",
        assertionResults: assertions,
        extractedValues: extractValues(step.extract, response),
        response: {
          status: 200,
          headers: {},
          body: JSON.stringify(response, null, 2),
          duration: Date.now() - startedAt.getTime(),
        },
        startedAt,
        finishedAt: new Date(),
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        stepKey: step.step_key,
        scenarioName: "",
        action: step.action,
        status: "error",
        errorMessage,
        startedAt,
        finishedAt: new Date(),
      };
    }
  }

  private async pollFirebaseAPI(
    config: FirebaseConfig,
  ): Promise<{ response: unknown; count?: number }> {
    const poll = config.poll!;
    const deadline = Date.now() + poll.timeout_ms;
    let lastResult: { response: unknown; count?: number } | undefined;

    while (Date.now() < deadline) {
      lastResult = await this.callFirebaseAPI(config);

      const value = getJsonPath(lastResult.response, poll.until.path);
      if (String(value) === poll.until.equals) {
        return lastResult;
      }

      await new Promise((resolve) => setTimeout(resolve, poll.interval_ms));
    }

    return lastResult ?? await this.callFirebaseAPI(config);
  }

  private async callFirebaseAPI(
    config: FirebaseConfig,
  ): Promise<{ response: unknown; count?: number }> {
    const p = (config.params ?? {}) as Record<string, string>;

    switch (config.operation) {
      // Firestore
      case "get_document":
        return this.getDocument(config, p);
      case "list_documents":
        return this.listDocuments(config, p);
      case "count_documents":
        return this.countDocuments(config, p);
      case "collection_group_query":
        return this.collectionGroupQuery(config, p);
      case "list_subcollections":
        return this.listSubcollections(p);

      // Auth
      case "get_user_by_uid":
        return this.getUserByUid(p);
      case "get_user_by_email":
        return this.getUserByEmail(p);
      case "get_user_by_phone":
        return this.getUserByPhone(p);
      case "list_users":
        return this.listUsers(config);

      // Storage
      case "list_files":
        return this.listFiles(config, p);
      case "get_file_metadata":
        return this.getFileMetadata(p);
      case "file_exists":
        return this.fileExists(p);

      // Realtime Database
      case "get_node":
        return this.getNode(p);
      case "query_nodes":
        return this.queryNodes(config, p);

      default:
        throw new Error(`Unknown Firebase operation: ${config.operation}`);
    }
  }

  // --- Firestore operations ---

  private getFirestore(config: FirebaseConfig): FirebaseFirestore.Firestore {
    if (config.database_id) {
      return getFirestore(this.app, config.database_id);
    }
    return this.app.firestore();
  }

  private async getDocument(
    config: FirebaseConfig,
    params: Record<string, string>,
  ): Promise<{ response: unknown; count?: number }> {
    const db = this.getFirestore(config);
    const doc = await db.doc(params.path).get();

    if (!doc.exists) {
      return { response: null };
    }

    const data = { id: doc.id, ...doc.data() };
    return { response: convertFirestoreTypes(data) };
  }

  private async listDocuments(
    config: FirebaseConfig,
    params: Record<string, string>,
  ): Promise<{ response: unknown; count?: number }> {
    const db = this.getFirestore(config);
    let query: FirebaseFirestore.Query = db.collection(params.collection);

    query = this.applyFirestoreQuery(query, config);

    const snapshot = await query.get();
    const docs = snapshot.docs.map((doc) =>
      convertFirestoreTypes({ id: doc.id, ...doc.data() })
    );

    return { response: docs, count: docs.length };
  }

  private async countDocuments(
    config: FirebaseConfig,
    params: Record<string, string>,
  ): Promise<{ response: unknown; count?: number }> {
    const db = this.getFirestore(config);
    let query: FirebaseFirestore.Query = db.collection(params.collection);

    query = this.applyFirestoreFilters(query, config);

    const snapshot = await query.count().get();
    const count = snapshot.data().count;

    return { response: { count }, count };
  }

  private async collectionGroupQuery(
    config: FirebaseConfig,
    params: Record<string, string>,
  ): Promise<{ response: unknown; count?: number }> {
    const db = this.getFirestore(config);
    let query: FirebaseFirestore.Query = db.collectionGroup(params.collection_id);

    query = this.applyFirestoreQuery(query, config);

    const snapshot = await query.get();
    const docs = snapshot.docs.map((doc) =>
      convertFirestoreTypes({ id: doc.id, path: doc.ref.path, ...doc.data() })
    );

    return { response: docs, count: docs.length };
  }

  private async listSubcollections(
    params: Record<string, string>,
  ): Promise<{ response: unknown; count?: number }> {
    const db = this.app.firestore();
    const collections = await db.doc(params.path).listCollections();
    const names = collections.map((col) => col.id);

    return { response: names, count: names.length };
  }

  private applyFirestoreFilters(
    query: FirebaseFirestore.Query,
    config: FirebaseConfig,
  ): FirebaseFirestore.Query {
    if (config.filters) {
      for (const filter of config.filters) {
        const op = FIRESTORE_OPERATORS[filter.operator];
        if (op) {
          query = query.where(filter.field, op, filter.value);
        }
      }
    }
    return query;
  }

  private applyFirestoreQuery(
    query: FirebaseFirestore.Query,
    config: FirebaseConfig,
  ): FirebaseFirestore.Query {
    query = this.applyFirestoreFilters(query, config);

    if (config.order_by) {
      query = query.orderBy(config.order_by.field, config.order_by.direction);
    }

    if (config.select) {
      query = query.select(...config.select);
    }

    if (config.limit !== undefined) {
      query = query.limit(config.limit);
    }

    return query;
  }

  // --- Auth operations ---

  private async getUserByUid(
    params: Record<string, string>,
  ): Promise<{ response: unknown }> {
    try {
      const user = await this.app.auth().getUser(params.uid);
      return { response: user.toJSON() };
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "auth/user-not-found") {
        return { response: null };
      }
      throw err;
    }
  }

  private async getUserByEmail(
    params: Record<string, string>,
  ): Promise<{ response: unknown }> {
    try {
      const user = await this.app.auth().getUserByEmail(params.email);
      return { response: user.toJSON() };
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "auth/user-not-found") {
        return { response: null };
      }
      throw err;
    }
  }

  private async getUserByPhone(
    params: Record<string, string>,
  ): Promise<{ response: unknown }> {
    try {
      const user = await this.app.auth().getUserByPhoneNumber(params.phone);
      return { response: user.toJSON() };
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "auth/user-not-found") {
        return { response: null };
      }
      throw err;
    }
  }

  private async listUsers(
    config: FirebaseConfig,
  ): Promise<{ response: unknown; count?: number }> {
    const result = await this.app.auth().listUsers(config.limit);
    const users = result.users.map((u) => u.toJSON());
    return { response: users, count: users.length };
  }

  // --- Storage operations ---

  private async listFiles(
    config: FirebaseConfig,
    params: Record<string, string>,
  ): Promise<{ response: unknown; count?: number }> {
    const bucket = this.app.storage().bucket();
    const [files] = await bucket.getFiles({
      prefix: params.prefix,
      maxResults: config.limit,
    });
    const fileList = files.map((f) => ({
      name: f.name,
      metadata: f.metadata,
    }));

    return { response: fileList, count: fileList.length };
  }

  private async getFileMetadata(
    params: Record<string, string>,
  ): Promise<{ response: unknown }> {
    const bucket = this.app.storage().bucket();
    const [metadata] = await bucket.file(params.path).getMetadata();
    return { response: metadata };
  }

  private async fileExists(
    params: Record<string, string>,
  ): Promise<{ response: unknown }> {
    const bucket = this.app.storage().bucket();
    const [exists] = await bucket.file(params.path).exists();
    return { response: exists ? { exists: true, path: params.path } : null };
  }

  // --- Realtime Database operations ---

  private async getNode(
    params: Record<string, string>,
  ): Promise<{ response: unknown }> {
    const snapshot = await this.app.database().ref(params.path).get();

    if (!snapshot.exists()) {
      return { response: null };
    }

    return { response: snapshot.val() };
  }

  private async queryNodes(
    config: FirebaseConfig,
    params: Record<string, string>,
  ): Promise<{ response: unknown; count?: number }> {
    let ref: admin.database.Query = this.app.database().ref(params.path);

    if (config.rtdb_query) {
      const q = config.rtdb_query;

      switch (q.order_by) {
        case "child":
          ref = ref.orderByChild(q.order_by_child!);
          break;
        case "key":
          ref = ref.orderByKey();
          break;
        case "value":
          ref = ref.orderByValue();
          break;
      }

      if (q.equal_to !== undefined) {
        ref = ref.equalTo(q.equal_to);
      }
      if (q.start_at !== undefined) {
        ref = ref.startAt(q.start_at);
      }
      if (q.end_at !== undefined) {
        ref = ref.endAt(q.end_at);
      }
      if (q.limit_to_first !== undefined) {
        ref = ref.limitToFirst(q.limit_to_first);
      }
      if (q.limit_to_last !== undefined) {
        ref = ref.limitToLast(q.limit_to_last);
      }
    }

    const snapshot = await ref.get();

    if (!snapshot.exists()) {
      return { response: null, count: 0 };
    }

    const val = snapshot.val();
    const count = typeof val === "object" && val !== null ? Object.keys(val).length : 1;

    return { response: val, count };
  }
}

/**
 * Initialize Firebase Admin SDK and return app instance.
 * Supports both service account auth and emulator mode.
 */
export function initializeFirebaseApp(
  variables: Record<string, string>,
  config: FirebaseConfig,
): admin.app.App {
  const projectId = variables[config.project_id_variable];
  const isEmulator = variables[config.emulator_variable] === "true";

  if (isEmulator) {
    // Set emulator environment variables
    const firestoreHost = variables[config.firestore_emulator_host_variable];
    const authHost = variables[config.auth_emulator_host_variable];
    const storageHost = variables[config.storage_emulator_host_variable];
    const databaseHost = variables[config.database_emulator_host_variable];

    if (firestoreHost) process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
    if (authHost) process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
    if (storageHost) process.env.FIREBASE_STORAGE_EMULATOR_HOST = storageHost;
    if (databaseHost) process.env.FIREBASE_DATABASE_EMULATOR_HOST = databaseHost;

    return admin.initializeApp(
      { projectId: projectId || "demo-test-project" },
      `aqua-firebase-${Date.now()}`,
    );
  }

  // Service account auth
  const serviceAccountPath = config.service_account_path_variable
    ? variables[config.service_account_path_variable]
    : undefined;

  if (serviceAccountPath) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const serviceAccount = require(serviceAccountPath);
    return admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount) },
      `aqua-firebase-${Date.now()}`,
    );
  }

  const clientEmail = variables[config.client_email_variable];
  const privateKey = variables[config.private_key_variable];

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Firebase credentials are required. Set them in your environment file:\n` +
      `  "secrets": {\n` +
      `    "firebase_project_id": { "type": "env", "name": "FIREBASE_PROJECT_ID" },\n` +
      `    "firebase_client_email": { "type": "env", "name": "FIREBASE_CLIENT_EMAIL" },\n` +
      `    "firebase_private_key": { "type": "env", "name": "FIREBASE_PRIVATE_KEY" }\n` +
      `  }\n` +
      `Or enable emulator mode: "firebase_emulator": "true"`
    );
  }

  return admin.initializeApp(
    {
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    },
    `aqua-firebase-${Date.now()}`,
  );
}
