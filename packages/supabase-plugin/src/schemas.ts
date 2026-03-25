import { z } from "zod";

export const SupabaseFilterSchema = z.object({
  column: z.string(),
  operator: z.enum([
    "eq", "neq", "gt", "gte", "lt", "lte",
    "like", "ilike", "is", "in",
    "contains", "containedBy",
  ]),
  value: z.string(),
});

export const SupabaseConfigSchema = z.object({
  /** Variable name holding the Supabase URL (default: "supabase_url") */
  url_variable: z.string().default("supabase_url"),

  /** Variable name holding the service role key (default: "supabase_service_role_key") */
  service_role_key_variable: z.string().default("supabase_service_role_key"),

  /** Supabase operation to perform */
  operation: z.enum([
    // Database
    "get_row",
    "list_rows",
    "count_rows",
    "call_rpc",
    // Auth
    "get_user_by_id",
    "list_users",
    "get_user_by_email",
    // Storage
    "list_files",
    "get_bucket",
    "list_buckets",
    "download_file",
    // Edge Functions
    "invoke_function",
  ]),

  /** Operation parameters (table, column, value, bucket, path, etc.) */
  params: z.record(z.string()).optional(),

  /** Filters for database queries */
  filters: z.array(SupabaseFilterSchema).optional(),

  /** Select columns (supports PostgREST nested select, e.g. "*, order_items(*)") */
  select: z.string().optional(),

  /** Max items for list operations (default: 10) */
  limit: z.number().optional().default(10),

  /** Polling config for waiting on async state changes */
  poll: z.object({
    /** Polling interval in ms (default: 2000) */
    interval_ms: z.number().default(2000),
    /** Timeout in ms (default: 30000) */
    timeout_ms: z.number().default(30000),
    /** Stop condition: when response field matches expected value */
    until: z.object({
      /** Dot-path to check in response (e.g. "status", "data[0].status") */
      path: z.string(),
      /** Expected value */
      equals: z.string(),
    }),
  }).optional(),
});

export type SupabaseConfig = z.infer<typeof SupabaseConfigSchema>;
export type SupabaseFilter = z.infer<typeof SupabaseFilterSchema>;

export const SupabaseFieldAssertionSchema = z.object({
  type: z.literal("supabase_field"),
  description: z.string().optional(),
  /** Dot-path in response (e.g. "status", "items[0].price.id") */
  path: z.string(),
  /** Expected value */
  expected: z.string(),
  /** Comparison condition (default: equals) */
  condition: z.enum([
    "equals", "contains", "not_equals",
    "exists", "not_exists",
    "greater_than", "less_than",
  ]).optional(),
});

export const SupabaseRowExistsAssertionSchema = z.object({
  type: z.literal("supabase_row_exists"),
  description: z.string().optional(),
  /** true: row should exist, false: should not exist */
  exists: z.boolean().default(true),
});

export const SupabaseRowCountAssertionSchema = z.object({
  type: z.literal("supabase_row_count"),
  description: z.string().optional(),
  /** Expected count */
  expected: z.number(),
  /** Comparison condition (default: equals) */
  condition: z.enum(["equals", "greater_than", "less_than"]).optional(),
});

export type SupabaseFieldAssertion = z.infer<typeof SupabaseFieldAssertionSchema>;
export type SupabaseRowExistsAssertion = z.infer<typeof SupabaseRowExistsAssertionSchema>;
export type SupabaseRowCountAssertion = z.infer<typeof SupabaseRowCountAssertionSchema>;
export type SupabaseAssertion = SupabaseFieldAssertion | SupabaseRowExistsAssertion | SupabaseRowCountAssertion;
