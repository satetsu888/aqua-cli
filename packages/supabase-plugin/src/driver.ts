import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getJsonPath, extractValues } from "@aquaqa/cli/utils";
import type { Driver, Step, StepResult } from "@aquaqa/cli/plugin";
import type { SupabaseConfig, SupabaseFilter, SupabaseAssertion } from "./schemas.js";
import { evaluateAssertions } from "./assertions.js";

export class SupabaseDriver implements Driver {
  private supabase: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.supabase = createClient(url, serviceRoleKey);
  }

  async execute(
    step: Step,
    _variables: Record<string, string>
  ): Promise<StepResult> {
    const config = step.config as SupabaseConfig;
    const startedAt = new Date();

    try {
      let response: unknown;

      if (config.poll) {
        response = await this.pollSupabaseAPI(config);
      } else {
        response = await this.callSupabaseAPI(config);
      }

      const assertions = evaluateAssertions(
        step.assertions as SupabaseAssertion[] | undefined,
        response
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

  private async pollSupabaseAPI(config: SupabaseConfig): Promise<unknown> {
    const poll = config.poll!;
    const deadline = Date.now() + poll.timeout_ms;
    let lastResponse: unknown;

    while (Date.now() < deadline) {
      lastResponse = await this.callSupabaseAPI(config);

      const value = getJsonPath(lastResponse, poll.until.path);
      if (String(value) === poll.until.equals) {
        return lastResponse;
      }

      await new Promise((resolve) => setTimeout(resolve, poll.interval_ms));
    }

    return lastResponse ?? await this.callSupabaseAPI(config);
  }

  private async callSupabaseAPI(config: SupabaseConfig): Promise<unknown> {
    const p = config.params ?? {};

    switch (config.operation) {
      // Database operations
      case "get_row":
        return this.getRow(p.table, p.column, p.value, config.select);
      case "list_rows":
        return this.listRows(p.table, config.select, config.filters, config.limit);
      case "count_rows":
        return this.countRows(p.table, config.filters);
      case "call_rpc":
        return this.callRpc(p.function_name, p);

      // Auth operations
      case "get_user_by_id":
        return this.getUserById(p.id);
      case "list_users":
        return this.listUsers(config.limit);
      case "get_user_by_email":
        return this.getUserByEmail(p.email);

      // Storage operations
      case "list_files":
        return this.listFiles(p.bucket, p.path, config.limit);
      case "get_bucket":
        return this.getBucket(p.id);
      case "list_buckets":
        return this.listBuckets();
      case "download_file":
        return this.downloadFile(p.bucket, p.path);

      // Edge Functions
      case "invoke_function":
        return this.invokeFunction(p.name, p.body);

      default:
        throw new Error(`Unknown Supabase operation: ${config.operation}`);
    }
  }

  // --- Database ---

  private async getRow(
    table: string,
    column: string,
    value: string,
    select?: string,
  ): Promise<unknown> {
    const { data, error } = await this.supabase
      .from(table)
      .select(select ?? "*")
      .eq(column, value)
      .maybeSingle();

    if (error) throw new Error(`Supabase query error: ${error.message}`);
    return data;
  }

  private async listRows(
    table: string,
    select?: string,
    filters?: SupabaseFilter[],
    limit?: number,
  ): Promise<unknown> {
    let query = this.supabase.from(table).select(select ?? "*");

    if (filters) {
      for (const f of filters) {
        query = this.applyFilter(query, f);
      }
    }

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Supabase query error: ${error.message}`);
    return data;
  }

  private async countRows(
    table: string,
    filters?: SupabaseFilter[],
  ): Promise<unknown> {
    let query = this.supabase.from(table).select("*", { count: "exact", head: true });

    if (filters) {
      for (const f of filters) {
        query = this.applyFilter(query, f);
      }
    }

    const { count, error } = await query;
    if (error) throw new Error(`Supabase query error: ${error.message}`);
    return { count };
  }

  private async callRpc(
    functionName: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const { function_name: _, ...rpcParams } = params;
    const { data, error } = await this.supabase.rpc(functionName, rpcParams);
    if (error) throw new Error(`Supabase RPC error: ${error.message}`);
    return data;
  }

  // --- Auth ---

  private async getUserById(id: string): Promise<unknown> {
    const { data, error } = await this.supabase.auth.admin.getUserById(id);
    if (error) throw new Error(`Supabase Auth error: ${error.message}`);
    return data.user;
  }

  private async listUsers(limit?: number): Promise<unknown> {
    const { data, error } = await this.supabase.auth.admin.listUsers({
      perPage: limit ?? 10,
    });
    if (error) throw new Error(`Supabase Auth error: ${error.message}`);
    return data.users;
  }

  private async getUserByEmail(email: string): Promise<unknown> {
    const { data, error } = await this.supabase.auth.admin.listUsers();
    if (error) throw new Error(`Supabase Auth error: ${error.message}`);
    const user = data.users.find((u) => u.email === email);
    return user ?? null;
  }

  // --- Storage ---

  private async listFiles(
    bucket: string,
    path?: string,
    limit?: number,
  ): Promise<unknown> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(path ?? "", { limit: limit ?? 10 });
    if (error) throw new Error(`Supabase Storage error: ${error.message}`);
    return data;
  }

  private async getBucket(id: string): Promise<unknown> {
    const { data, error } = await this.supabase.storage.getBucket(id);
    if (error) throw new Error(`Supabase Storage error: ${error.message}`);
    return data;
  }

  private async listBuckets(): Promise<unknown> {
    const { data, error } = await this.supabase.storage.listBuckets();
    if (error) throw new Error(`Supabase Storage error: ${error.message}`);
    return data;
  }

  private async downloadFile(bucket: string, path: string): Promise<unknown> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .download(path);
    if (error) throw new Error(`Supabase Storage error: ${error.message}`);
    return {
      size: data.size,
      type: data.type,
    };
  }

  // --- Edge Functions ---

  private async invokeFunction(
    name: string,
    body?: string,
  ): Promise<unknown> {
    const { data, error } = await this.supabase.functions.invoke(name, {
      body: body ? JSON.parse(body) : undefined,
    });
    if (error) throw new Error(`Supabase Functions error: ${error.message}`);
    return data;
  }

  // --- Helpers ---

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyFilter(query: any, filter: SupabaseFilter): any {
    switch (filter.operator) {
      case "eq":
        return query.eq(filter.column, filter.value);
      case "neq":
        return query.neq(filter.column, filter.value);
      case "gt":
        return query.gt(filter.column, filter.value);
      case "gte":
        return query.gte(filter.column, filter.value);
      case "lt":
        return query.lt(filter.column, filter.value);
      case "lte":
        return query.lte(filter.column, filter.value);
      case "like":
        return query.like(filter.column, filter.value);
      case "ilike":
        return query.ilike(filter.column, filter.value);
      case "is":
        return query.is(filter.column, filter.value === "null" ? null : filter.value === "true");
      case "in":
        return query.in(filter.column, filter.value.split(",").map((v) => v.trim()));
      case "contains":
        return query.contains(filter.column, JSON.parse(filter.value));
      case "containedBy":
        return query.containedBy(filter.column, JSON.parse(filter.value));
      default:
        throw new Error(`Unknown filter operator: ${filter.operator}`);
    }
  }
}
