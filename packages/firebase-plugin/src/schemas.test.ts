import { describe, it, expect } from "vitest";
import {
  FirebaseConfigSchema,
  FirebaseFieldAssertionSchema,
  FirebaseDocumentExistsAssertionSchema,
  FirebaseCountAssertionSchema,
} from "./schemas.js";

describe("FirebaseConfigSchema", () => {
  it("parses with minimum config (operation only)", () => {
    const result = FirebaseConfigSchema.parse({ operation: "get_document" });
    expect(result.operation).toBe("get_document");
    expect(result.project_id_variable).toBe("firebase_project_id");
    expect(result.client_email_variable).toBe("firebase_client_email");
    expect(result.private_key_variable).toBe("firebase_private_key");
    expect(result.emulator_variable).toBe("firebase_emulator");
    expect(result.limit).toBe(10);
  });

  it("parses with all fields specified", () => {
    const result = FirebaseConfigSchema.parse({
      project_id_variable: "my_project_id",
      client_email_variable: "my_client_email",
      private_key_variable: "my_private_key",
      service_account_path_variable: "my_sa_path",
      emulator_variable: "my_emulator",
      firestore_emulator_host_variable: "my_fs_host",
      auth_emulator_host_variable: "my_auth_host",
      storage_emulator_host_variable: "my_storage_host",
      database_emulator_host_variable: "my_db_host",
      database_id: "my-secondary-db",
      operation: "list_documents",
      params: { collection: "orders" },
      filters: [{ field: "status", operator: "eq", value: "pending" }],
      order_by: { field: "createdAt", direction: "desc" },
      select: ["id", "status"],
      limit: 20,
      rtdb_query: {
        order_by: "child",
        order_by_child: "score",
        equal_to: 100,
        limit_to_first: 5,
      },
      poll: {
        interval_ms: 3000,
        timeout_ms: 60000,
        until: { path: "status", equals: "done" },
      },
    });
    expect(result.database_id).toBe("my-secondary-db");
    expect(result.filters).toHaveLength(1);
    expect(result.order_by?.direction).toBe("desc");
    expect(result.limit).toBe(20);
  });

  it("rejects invalid operation", () => {
    expect(() => FirebaseConfigSchema.parse({ operation: "invalid_op" })).toThrow();
  });

  it("rejects invalid filter operator", () => {
    expect(() =>
      FirebaseConfigSchema.parse({
        operation: "list_documents",
        filters: [{ field: "x", operator: "like", value: "y" }],
      })
    ).toThrow();
  });

  it("accepts array values for in/not_in/array_contains_any filters", () => {
    const result = FirebaseConfigSchema.parse({
      operation: "list_documents",
      filters: [
        { field: "status", operator: "in", value: ["active", "pending"] },
        { field: "tags", operator: "array_contains_any", value: ["a", "b"] },
      ],
    });
    expect(result.filters).toHaveLength(2);
    expect(result.filters![0].value).toEqual(["active", "pending"]);
  });

  it("accepts all valid operations", () => {
    const ops = [
      "get_document", "list_documents", "count_documents",
      "collection_group_query", "list_subcollections",
      "get_user_by_uid", "get_user_by_email", "get_user_by_phone", "list_users",
      "list_files", "get_file_metadata", "file_exists",
      "get_node", "query_nodes",
    ];
    for (const op of ops) {
      expect(() => FirebaseConfigSchema.parse({ operation: op })).not.toThrow();
    }
  });
});

describe("FirebaseFieldAssertionSchema", () => {
  it("parses valid assertion with all conditions", () => {
    const conditions = ["equals", "not_equals", "contains", "exists", "not_exists", "greater_than", "less_than"];
    for (const condition of conditions) {
      const result = FirebaseFieldAssertionSchema.parse({
        type: "firebase_field",
        path: "status",
        expected: "active",
        condition,
      });
      expect(result.condition).toBe(condition);
    }
  });

  it("rejects invalid condition", () => {
    expect(() =>
      FirebaseFieldAssertionSchema.parse({
        type: "firebase_field",
        path: "status",
        expected: "active",
        condition: "invalid",
      })
    ).toThrow();
  });
});

describe("FirebaseDocumentExistsAssertionSchema", () => {
  it("parses with exists true and false", () => {
    expect(
      FirebaseDocumentExistsAssertionSchema.parse({ type: "firebase_document_exists", exists: true }).exists
    ).toBe(true);
    expect(
      FirebaseDocumentExistsAssertionSchema.parse({ type: "firebase_document_exists", exists: false }).exists
    ).toBe(false);
  });

  it("defaults exists to true", () => {
    expect(
      FirebaseDocumentExistsAssertionSchema.parse({ type: "firebase_document_exists" }).exists
    ).toBe(true);
  });
});

describe("FirebaseCountAssertionSchema", () => {
  it("parses with all conditions", () => {
    for (const condition of ["equals", "greater_than", "less_than"]) {
      const result = FirebaseCountAssertionSchema.parse({
        type: "firebase_count",
        expected: 5,
        condition,
      });
      expect(result.condition).toBe(condition);
    }
  });

  it("defaults condition to equals", () => {
    expect(
      FirebaseCountAssertionSchema.parse({ type: "firebase_count", expected: 3 }).condition
    ).toBe("equals");
  });

  it("requires expected to be a number", () => {
    expect(() =>
      FirebaseCountAssertionSchema.parse({ type: "firebase_count", expected: "three" })
    ).toThrow();
  });
});
