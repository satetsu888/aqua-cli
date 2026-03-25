import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseDriver } from "./driver.js";

// Mock Supabase client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();
const mockLimit = vi.fn();
const mockRpc = vi.fn();

const mockAuthAdmin = {
  getUserById: vi.fn(),
  listUsers: vi.fn(),
};

const mockStorageFrom = vi.fn();
const mockStorageList = vi.fn();
const mockStorageGetBucket = vi.fn();
const mockStorageListBuckets = vi.fn();
const mockStorageDownload = vi.fn();

const mockFunctionsInvoke = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: { admin: mockAuthAdmin },
    storage: {
      from: mockStorageFrom,
      getBucket: mockStorageGetBucket,
      listBuckets: mockStorageListBuckets,
    },
    functions: { invoke: mockFunctionsInvoke },
  }),
}));

function makeStep(overrides?: Record<string, unknown>) {
  return {
    id: "stp1",
    step_key: "check_row",
    action: "supabase",
    config: {
      operation: "get_row",
      params: { table: "orders", column: "id", value: "order_123" },
    },
    sort_order: 0,
    ...overrides,
  };
}

function setupQueryChain(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain = {
    select: mockSelect.mockReturnThis(),
    eq: mockEq.mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    containedBy: vi.fn().mockReturnThis(),
    limit: mockLimit.mockReturnValue({
      ...result,
      then: (resolve: (value: unknown) => void) => resolve(result),
    }),
    maybeSingle: mockMaybeSingle.mockResolvedValue(result),
    then: (resolve: (value: unknown) => void) => resolve(result),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

describe("SupabaseDriver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Database operations", () => {
    it("executes get_row and returns passed", async () => {
      const mockData = { id: "order_123", status: "pending", total: 5000 };
      setupQueryChain({ data: mockData, error: null });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(makeStep() as never, {});

      expect(result.status).toBe("passed");
      expect(mockFrom).toHaveBeenCalledWith("orders");
      expect(mockSelect).toHaveBeenCalledWith("*");
      expect(mockEq).toHaveBeenCalledWith("id", "order_123");
      expect(result.response?.body).toContain("pending");
    });

    it("evaluates supabase_field assertions", async () => {
      setupQueryChain({ data: { id: "order_123", status: "pending" }, error: null });

      const step = makeStep({
        assertions: [
          { type: "supabase_field", path: "status", expected: "pending" },
        ],
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("passed");
      expect(result.assertionResults).toHaveLength(1);
      expect(result.assertionResults![0].passed).toBe(true);
    });

    it("returns failed when assertion does not match", async () => {
      setupQueryChain({ data: { id: "order_123", status: "cancelled" }, error: null });

      const step = makeStep({
        assertions: [
          { type: "supabase_field", path: "status", expected: "pending" },
        ],
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("failed");
      expect(result.assertionResults![0].passed).toBe(false);
      expect(result.assertionResults![0].actual).toBe("cancelled");
    });

    it("extracts values from response", async () => {
      setupQueryChain({
        data: { id: "order_123", status: "pending", user_id: "user_456" },
        error: null,
      });

      const step = makeStep({
        extract: {
          order_status: "$.status",
          uid: "$.user_id",
        },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.extractedValues).toEqual({
        order_status: "pending",
        uid: "user_456",
      });
    });

    it("executes list_rows with filters", async () => {
      const chain = setupQueryChain({
        data: [{ id: 1, status: "active" }, { id: 2, status: "active" }],
        error: null,
      });

      const step = makeStep({
        config: {
          operation: "list_rows",
          params: { table: "users" },
          filters: [{ column: "status", operator: "eq", value: "active" }],
          limit: 5,
        },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("passed");
      expect(mockFrom).toHaveBeenCalledWith("users");
      expect(chain.eq).toHaveBeenCalledWith("status", "active");
    });

    it("executes count_rows", async () => {
      setupQueryChain({ count: 42, error: null });
      // Override select for count
      mockSelect.mockReturnValue({
        eq: mockEq,
        then: (resolve: (value: unknown) => void) => resolve({ count: 42, error: null }),
      });

      const step = makeStep({
        config: {
          operation: "count_rows",
          params: { table: "orders" },
        },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("passed");
      expect(mockFrom).toHaveBeenCalledWith("orders");
      expect(mockSelect).toHaveBeenCalledWith("*", { count: "exact", head: true });
    });

    it("returns error when query fails", async () => {
      setupQueryChain({ data: null, error: { message: "relation does not exist" } });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(makeStep() as never, {});

      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain("relation does not exist");
    });

    it("passes custom select to get_row", async () => {
      setupQueryChain({ data: { id: "1", items: [{ name: "a" }] }, error: null });

      const step = makeStep({
        config: {
          operation: "get_row",
          params: { table: "orders", column: "id", value: "1" },
          select: "*, items(*)",
        },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      await driver.execute(step as never, {});

      expect(mockSelect).toHaveBeenCalledWith("*, items(*)");
    });
  });

  describe("Auth operations", () => {
    it("executes get_user_by_id", async () => {
      mockAuthAdmin.getUserById.mockResolvedValue({
        data: { user: { id: "user_1", email: "test@example.com" } },
        error: null,
      });

      const step = makeStep({
        config: {
          operation: "get_user_by_id",
          params: { id: "user_1" },
        },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("passed");
      expect(mockAuthAdmin.getUserById).toHaveBeenCalledWith("user_1");
      expect(result.response?.body).toContain("test@example.com");
    });

    it("executes get_user_by_email", async () => {
      mockAuthAdmin.listUsers.mockResolvedValue({
        data: {
          users: [
            { id: "user_1", email: "test@example.com" },
            { id: "user_2", email: "other@example.com" },
          ],
        },
        error: null,
      });

      const step = makeStep({
        config: {
          operation: "get_user_by_email",
          params: { email: "test@example.com" },
        },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("passed");
      expect(result.response?.body).toContain("user_1");
    });

    it("returns null when user not found by email", async () => {
      mockAuthAdmin.listUsers.mockResolvedValue({
        data: { users: [] },
        error: null,
      });

      const step = makeStep({
        config: {
          operation: "get_user_by_email",
          params: { email: "unknown@example.com" },
        },
        assertions: [
          { type: "supabase_row_exists", exists: false },
        ],
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("passed");
      expect(result.assertionResults![0].passed).toBe(true);
    });
  });

  describe("Storage operations", () => {
    it("executes list_files", async () => {
      const files = [
        { name: "avatar.png", metadata: { mimetype: "image/png", size: 1024 } },
      ];
      mockStorageFrom.mockReturnValue({
        list: mockStorageList.mockResolvedValue({ data: files, error: null }),
      });

      const step = makeStep({
        config: {
          operation: "list_files",
          params: { bucket: "avatars", path: "user_1" },
        },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("passed");
      expect(mockStorageFrom).toHaveBeenCalledWith("avatars");
      expect(mockStorageList).toHaveBeenCalledWith("user_1", { limit: 10 });
      expect(result.response?.body).toContain("avatar.png");
    });

    it("executes get_bucket", async () => {
      mockStorageGetBucket.mockResolvedValue({
        data: { id: "avatars", public: true },
        error: null,
      });

      const step = makeStep({
        config: {
          operation: "get_bucket",
          params: { id: "avatars" },
        },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("passed");
      expect(mockStorageGetBucket).toHaveBeenCalledWith("avatars");
    });
  });

  describe("Edge Functions", () => {
    it("executes invoke_function", async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { success: true, result: "ok" },
        error: null,
      });

      const step = makeStep({
        config: {
          operation: "invoke_function",
          params: { name: "process-order", body: '{"order_id":"123"}' },
        },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("passed");
      expect(mockFunctionsInvoke).toHaveBeenCalledWith("process-order", {
        body: { order_id: "123" },
      });
    });
  });

  describe("Error handling", () => {
    it("returns error for unknown operation", async () => {
      const step = makeStep({
        config: { operation: "unknown_op", params: {} },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain("Unknown Supabase operation");
    });

    it("returns error when Auth API fails", async () => {
      mockAuthAdmin.getUserById.mockResolvedValue({
        data: null,
        error: { message: "User not found" },
      });

      const step = makeStep({
        config: { operation: "get_user_by_id", params: { id: "invalid" } },
      });

      const driver = new SupabaseDriver("https://test.supabase.co", "service_role_key");
      const result = await driver.execute(step as never, {});

      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain("User not found");
    });
  });
});
