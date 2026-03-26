import { z } from "zod";

export const FirebaseConfigSchema = z.object({
  /** Variable name holding the Firebase project ID (default: "firebase_project_id") */
  project_id_variable: z.string().default("firebase_project_id"),

  /** Variable name holding the service account client email (default: "firebase_client_email") */
  client_email_variable: z.string().default("firebase_client_email"),

  /** Variable name holding the service account private key (default: "firebase_private_key") */
  private_key_variable: z.string().default("firebase_private_key"),

  /** Variable name holding the service account JSON file path (optional, takes priority) */
  service_account_path_variable: z.string().optional(),

  /** Variable name for emulator mode flag (default: "firebase_emulator") */
  emulator_variable: z.string().default("firebase_emulator"),

  /** Variable name for Firestore emulator host (default: "firebase_firestore_emulator_host") */
  firestore_emulator_host_variable: z.string().default("firebase_firestore_emulator_host"),

  /** Variable name for Auth emulator host (default: "firebase_auth_emulator_host") */
  auth_emulator_host_variable: z.string().default("firebase_auth_emulator_host"),

  /** Variable name for Storage emulator host (default: "firebase_storage_emulator_host") */
  storage_emulator_host_variable: z.string().default("firebase_storage_emulator_host"),

  /** Variable name for RTDB emulator host (default: "firebase_database_emulator_host") */
  database_emulator_host_variable: z.string().default("firebase_database_emulator_host"),

  /** Firestore database ID (default: uses "(default)") */
  database_id: z.string().optional(),

  /** Firebase operation to perform */
  operation: z.enum([
    // Firestore
    "get_document",
    "list_documents",
    "count_documents",
    "collection_group_query",
    "list_subcollections",
    // Auth
    "get_user_by_uid",
    "get_user_by_email",
    "get_user_by_phone",
    "list_users",
    // Storage
    "list_files",
    "get_file_metadata",
    "file_exists",
    // Realtime Database
    "get_node",
    "query_nodes",
  ]),

  /** Operation parameters (path, uid, email, bucket, prefix, etc.) */
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),

  /** Firestore query filters */
  filters: z.array(z.object({
    field: z.string(),
    operator: z.enum([
      "eq", "neq", "gt", "gte", "lt", "lte",
      "array_contains", "array_contains_any", "in", "not_in",
    ]),
    value: z.union([
      z.string(), z.number(), z.boolean(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
    ]),
  })).optional(),

  /** Firestore orderBy */
  order_by: z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).default("asc"),
  }).optional(),

  /** Firestore field mask (select specific fields) */
  select: z.array(z.string()).optional(),

  /** Max items for list/query operations (default: 10) */
  limit: z.number().optional().default(10),

  /** RTDB query options */
  rtdb_query: z.object({
    order_by: z.enum(["child", "key", "value"]),
    order_by_child: z.string().optional(),
    equal_to: z.union([z.string(), z.number(), z.boolean()]).optional(),
    start_at: z.union([z.string(), z.number()]).optional(),
    end_at: z.union([z.string(), z.number()]).optional(),
    limit_to_first: z.number().optional(),
    limit_to_last: z.number().optional(),
  }).optional(),

  /** Polling config for waiting on async state changes */
  poll: z.object({
    /** Polling interval in ms (default: 2000) */
    interval_ms: z.number().default(2000),
    /** Timeout in ms (default: 30000) */
    timeout_ms: z.number().default(30000),
    /** Stop condition: when response field matches expected value */
    until: z.object({
      /** Dot-path to check in response */
      path: z.string(),
      /** Expected value */
      equals: z.string(),
    }),
  }).optional(),
});

export type FirebaseConfig = z.infer<typeof FirebaseConfigSchema>;

export const FirebaseFieldAssertionSchema = z.object({
  type: z.literal("firebase_field"),
  description: z.string().optional(),
  /** Dot-path in response (e.g. "status", "metadata.plan", "items[0].name") */
  path: z.string(),
  /** Expected value */
  expected: z.string(),
  /** Comparison condition (default: equals) */
  condition: z.enum([
    "equals", "not_equals", "contains",
    "exists", "not_exists",
    "greater_than", "less_than",
  ]).optional(),
});

export const FirebaseDocumentExistsAssertionSchema = z.object({
  type: z.literal("firebase_document_exists"),
  description: z.string().optional(),
  /** true: document should exist, false: should not exist */
  exists: z.boolean().default(true),
});

export const FirebaseCountAssertionSchema = z.object({
  type: z.literal("firebase_count"),
  description: z.string().optional(),
  /** Expected count */
  expected: z.number(),
  /** Comparison condition (default: equals) */
  condition: z.enum(["equals", "greater_than", "less_than"]).default("equals"),
});

export type FirebaseFieldAssertion = z.infer<typeof FirebaseFieldAssertionSchema>;
export type FirebaseDocumentExistsAssertion = z.infer<typeof FirebaseDocumentExistsAssertionSchema>;
export type FirebaseCountAssertion = z.infer<typeof FirebaseCountAssertionSchema>;
export type FirebaseAssertion = FirebaseFieldAssertion | FirebaseDocumentExistsAssertion | FirebaseCountAssertion;
