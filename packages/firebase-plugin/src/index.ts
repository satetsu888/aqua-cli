import type { AquaPlugin } from "@aquaqa/cli/plugin";
import { FirebaseDriver, initializeFirebaseApp } from "./driver.js";
import {
  FirebaseConfigSchema,
  FirebaseFieldAssertionSchema,
  FirebaseDocumentExistsAssertionSchema,
  FirebaseCountAssertionSchema,
} from "./schemas.js";

const firebasePlugin: AquaPlugin = {
  name: "@aquaqa/firebase-plugin",
  actionType: "firebase",
  configSchema: FirebaseConfigSchema,
  assertionSchemas: [
    FirebaseFieldAssertionSchema,
    FirebaseDocumentExistsAssertionSchema,
    FirebaseCountAssertionSchema,
  ],

  actionDescription: [
    "Firebase でリソース状態を確認。サービスアカウントまたは Emulator を設定してください。",
    "Firestore operations: get_document, list_documents, count_documents, collection_group_query, list_subcollections",
    "Auth operations: get_user_by_uid, get_user_by_email, get_user_by_phone, list_users",
    "Storage operations: list_files, get_file_metadata, file_exists",
    "Realtime Database operations: get_node, query_nodes",
    "assertions: firebase_field (path + expected で値チェック), firebase_document_exists, firebase_count",
    "poll: { interval_ms, timeout_ms, until: { path, equals } } で非同期処理の完了待ちが可能",
    "Firestore の Timestamp, GeoPoint, DocumentReference は自動的にプレーン型に変換されます",
  ].join("\n    "),

  async createDriver(variables: Record<string, string>) {
    const config = FirebaseConfigSchema.parse({});
    const app = initializeFirebaseApp(variables, config);
    return new FirebaseDriver(app);
  },
};

export default firebasePlugin;
