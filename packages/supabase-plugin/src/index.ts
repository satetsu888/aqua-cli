import type { AquaPlugin } from "@aquaqa/cli/plugin";
import { SupabaseDriver } from "./driver.js";
import {
  SupabaseConfigSchema,
  SupabaseFieldAssertionSchema,
  SupabaseRowExistsAssertionSchema,
  SupabaseRowCountAssertionSchema,
} from "./schemas.js";

const supabasePlugin: AquaPlugin = {
  name: "@aquaqa/supabase-plugin",
  actionType: "supabase",
  configSchema: SupabaseConfigSchema,
  assertionSchemas: [
    SupabaseFieldAssertionSchema,
    SupabaseRowExistsAssertionSchema,
    SupabaseRowCountAssertionSchema,
  ],

  actionDescription: [
    "Supabase のリソース状態を確認。環境変数に supabase_url と supabase_service_role_key を設定してください。",
    "Database operations: get_row (table+column+value で1行取得), list_rows (filters でフィルタ), count_rows (行数取得), call_rpc (Postgres関数呼び出し)",
    "Auth operations: get_user_by_id, list_users, get_user_by_email",
    "Storage operations: list_files (bucket+path), get_bucket, list_buckets, download_file",
    "Edge Functions: invoke_function (name で関数呼び出し)",
    "assertions: supabase_field (path + expected で値チェック), supabase_row_exists, supabase_row_count (expected + condition で行数チェック)",
    "poll: { interval_ms, timeout_ms, until: { path, equals } } で非同期処理の完了待ちが可能",
  ].join("\n    "),

  async createDriver(variables: Record<string, string>) {
    const urlVariable = "supabase_url";
    const keyVariable = "supabase_service_role_key";

    const url = variables[urlVariable];
    if (!url) {
      throw new Error(
        `"${urlVariable}" variable is required. Set it in your environment file:\n` +
        `  "variables": { "${urlVariable}": "https://your-project.supabase.co" }`
      );
    }

    const serviceRoleKey = variables[keyVariable];
    if (!serviceRoleKey) {
      throw new Error(
        `"${keyVariable}" variable is required. Set it in your environment file:\n` +
        `  "secrets": { "${keyVariable}": { "type": "env", "name": "SUPABASE_SERVICE_ROLE_KEY" } }`
      );
    }

    return new SupabaseDriver(url, serviceRoleKey);
  },
};

export default supabasePlugin;
