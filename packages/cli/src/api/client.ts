export interface QAPlan {
  id: string;
  project_id: string;
  name: string;
  description: string;
  git_branch: string;
  pull_request_url: string;
  status: string;
  pinned: boolean;
  url: string;
  created_by?: string;
  latest_version?: QAPlanVersion;
  created_at: string;
  updated_at: string;
}

export interface QAPlanVersion {
  id: string;
  qa_plan_id: string;
  version: number;
  name: string;
  description: string;
  url: string;
  variables?: Record<string, string>;
  created_at: string;
}

export interface ScenarioResponse {
  id: string;
  name: string;
  requires?: string[];
  sort_order: number;
  steps: StepResponse[];
  source_common_scenario_id?: string;
}

export interface CommonScenario {
  id: string;
  project_id: string;
  name: string;
  description: string;
  requires?: string[];
  steps: CommonScenarioStep[];
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface CommonScenarioStep {
  step_key: string;
  action: string;
  config: Record<string, unknown>;
  assertions?: Array<Record<string, unknown>>;
  extract?: Record<string, string>;
  depends_on?: string[];
}

export interface StepResponse {
  id: string;
  step_key: string;
  action: string;
  config: Record<string, unknown>;
  assertions?: Array<Record<string, unknown>>;
  extract?: Record<string, string>;
  depends_on?: string[];
  sort_order: number;
}

export interface EnvironmentLayer {
  type: "qa_plan" | "environment" | "override";
  name?: string;
  variables: Record<string, string>;
}

export interface ProxyConfig {
  server: string;
  bypass?: string;
  username?: string;
  password?: string;
}

export interface EnvironmentResolution {
  layers: EnvironmentLayer[];
  proxy?: ProxyConfig;
}

export interface QuotaStatusEntry {
  exceeded: boolean;
  used: number;
  limit: number; // -1 = unlimited
}

export interface QuotaStatus {
  storage: QuotaStatusEntry;
}

export interface Execution {
  id: string;
  qa_plan_version_id: string;
  status: string;
  url: string;
  environment?: EnvironmentResolution;
  created_by?: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}

export interface StepExecution {
  id: string;
  execution_id: string;
  scenario_name: string;
  step_key: string;
  action: string;
  status: string;
  error_message?: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}

export interface Artifact {
  id: string;
  step_execution_id: string;
  type: string;
  content_type: string;
  content_hash: string;
  size_bytes: number;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AssertionResult {
  id: string;
  step_execution_id: string;
  assertion_type: string;
  expected?: string;
  actual?: string;
  passed: boolean;
  message?: string;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  is_personal: boolean;
  role?: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  project_key: string;
  repository_url: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  is_guest: boolean;
  has_password: boolean;
  created_at: string;
}

export interface ResolveProjectResponse {
  project: Project;
  merged: boolean;
  created: boolean;
}

export class AquaClient {
  private baseURL: string;
  private apiKey: string | null;
  private projectKey: string | null;
  private socketPath: string | null;
  private repoOwner: string | null;
  private repoName: string | null;

  constructor(
    baseURL: string,
    apiKey?: string | null,
    projectKey?: string | null,
    options?: { socketPath?: string; repoOwner?: string; repoName?: string }
  ) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.apiKey = apiKey ?? null;
    this.projectKey = projectKey ?? null;
    this.socketPath = options?.socketPath ?? null;
    this.repoOwner = options?.repoOwner ?? null;
    this.repoName = options?.repoName ?? null;
  }

  /** Whether this client is connected to aqua-desktop via UDS. */
  get isDesktopMode(): boolean {
    return this.socketPath !== null;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (this.socketPath) {
      return this.requestViaSocket<T>(method, path, body);
    }

    const url = `${this.baseURL}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (this.projectKey) {
      headers["X-Project-Key"] = this.projectKey;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) {
      return undefined as T;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(
        `API error ${res.status}: ${(error as { error: string }).error}`
      );
    }

    // Check for merge notification
    if (res.headers.get("X-Project-Merged") === "true") {
      process.stderr.write(
        "\nNotice: Your personal project data has been merged into the team project.\n"
      );
    }

    return res.json() as Promise<T>;
  }

  private async requestViaSocket<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const { request } = await import("node:http");
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.repoOwner) {
      headers["X-Repo-Owner"] = this.repoOwner;
    }
    if (this.repoName) {
      headers["X-Repo-Name"] = this.repoName;
    }
    if (bodyStr) {
      headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
    }

    return new Promise<T>((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socketPath!,
          path,
          method,
          headers,
          timeout: 30000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const responseBody = Buffer.concat(chunks).toString("utf-8");
            if (res.statusCode === 204) {
              resolve(undefined as T);
              return;
            }
            if (res.statusCode && res.statusCode >= 400) {
              const error = JSON.parse(responseBody).error || res.statusMessage;
              reject(new Error(`API error ${res.statusCode}: ${error}`));
              return;
            }
            try {
              resolve(JSON.parse(responseBody) as T);
            } catch {
              resolve(responseBody as unknown as T);
            }
          });
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });
      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  // QA Plans
  async createQAPlan(params: {
    project_id?: string;
    name: string;
    description?: string;
    git_branch?: string;
    pull_request_url?: string;
  }): Promise<QAPlan> {
    return this.request<QAPlan>("POST", "/api/qa-plans", params);
  }

  async getQAPlan(id: string): Promise<QAPlan> {
    return this.request<QAPlan>("GET", `/api/qa-plans/${id}`);
  }

  async listQAPlans(params?: {
    project_id?: string;
    status?: string;
    pinned?: boolean;
    include_archived?: boolean;
    git_branch?: string;
    pull_request_url?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: QAPlan[]; next_cursor: string | null }> {
    const query = new URLSearchParams();
    if (params?.project_id) query.set("project_id", params.project_id);
    if (params?.status) query.set("status", params.status);
    if (params?.pinned !== undefined) query.set("pinned", String(params.pinned));
    if (params?.include_archived) query.set("include_archived", "true");
    if (params?.git_branch) query.set("git_branch", params.git_branch);
    if (params?.pull_request_url) query.set("pull_request_url", params.pull_request_url);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.cursor) query.set("cursor", params.cursor);
    const qs = query.toString();
    return this.request<{ items: QAPlan[]; next_cursor: string | null }>(
      "GET",
      `/api/qa-plans${qs ? `?${qs}` : ""}`
    );
  }

  async updateQAPlan(
    id: string,
    params: { name?: string; description?: string; git_branch?: string; pull_request_url?: string }
  ): Promise<QAPlan> {
    return this.request<QAPlan>("PUT", `/api/qa-plans/${id}`, params);
  }

  async deleteQAPlan(id: string): Promise<void> {
    return this.request<void>("DELETE", `/api/qa-plans/${id}`);
  }

  async patchQAPlanState(
    id: string,
    data: { status?: string; pinned?: boolean; archived?: boolean }
  ): Promise<QAPlan> {
    return this.request<QAPlan>("PATCH", `/api/qa-plans/${id}`, data);
  }

  // QA Plan Versions
  async createQAPlanVersion(
    qaPlanId: string,
    params: {
      name?: string;
      description?: string;
      variables?: Record<string, string>;
      scenarios: Array<{
        name: string;
        requires?: string[];
        common_scenario_id?: string;
        steps: Array<{
          step_key: string;
          action: string;
          config: Record<string, unknown>;
          assertions?: Array<Record<string, unknown>>;
          extract?: Record<string, string>;
          depends_on?: string[];
        }>;
      }>;
    }
  ): Promise<QAPlanVersion> {
    return this.request<QAPlanVersion>(
      "POST",
      `/api/qa-plans/${qaPlanId}/versions`,
      params
    );
  }

  async patchQAPlanVersion(
    qaPlanId: string,
    params: {
      base_version: number;
      patches: PatchOperation[];
      name?: string;
      description?: string;
      variables?: Record<string, string>;
    }
  ): Promise<QAPlanVersion> {
    return this.request<QAPlanVersion>(
      "POST",
      `/api/qa-plans/${qaPlanId}/versions`,
      params
    );
  }

  async listQAPlanVersions(qaPlanId: string): Promise<QAPlanVersion[]> {
    return this.request<QAPlanVersion[]>(
      "GET",
      `/api/qa-plans/${qaPlanId}/versions`
    );
  }

  async getQAPlanVersion(
    qaPlanId: string,
    version: number
  ): Promise<QAPlanVersion> {
    return this.request<QAPlanVersion>(
      "GET",
      `/api/qa-plans/${qaPlanId}/versions/${version}`
    );
  }

  async getVersionScenarios(
    qaPlanId: string,
    version: number
  ): Promise<ScenarioResponse[]> {
    return this.request<ScenarioResponse[]>(
      "GET",
      `/api/qa-plans/${qaPlanId}/versions/${version}/scenarios`
    );
  }

  // Quota
  async getQuotaStatus(): Promise<QuotaStatus> {
    return this.request<QuotaStatus>("GET", "/api/quota/status");
  }

  // Executions
  async createExecution(params: {
    qa_plan_version_id: string;
    environment?: EnvironmentResolution;
  }): Promise<Execution> {
    return this.request<Execution>("POST", "/api/executions", params);
  }

  async getExecution(id: string): Promise<Execution> {
    return this.request<Execution>("GET", `/api/executions/${id}`);
  }

  async listExecutions(params?: {
    qa_plan_version_id?: string;
    qa_plan_id?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: Execution[]; next_cursor: string | null }> {
    const query = new URLSearchParams();
    if (params?.qa_plan_version_id)
      query.set("qa_plan_version_id", params.qa_plan_version_id);
    if (params?.qa_plan_id) query.set("qa_plan_id", params.qa_plan_id);
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.cursor) query.set("cursor", params.cursor);
    const qs = query.toString();
    return this.request<{ items: Execution[]; next_cursor: string | null }>(
      "GET",
      `/api/executions${qs ? `?${qs}` : ""}`
    );
  }

  async updateExecution(
    id: string,
    params: { status: string }
  ): Promise<Execution> {
    return this.request<Execution>("PATCH", `/api/executions/${id}`, params);
  }

  // Step Executions
  async createStepExecution(
    executionId: string,
    params: {
      scenario_name: string;
      step_key: string;
      action: string;
      status?: string;
      error_message?: string;
      step_definition_id?: string;
    }
  ): Promise<StepExecution> {
    return this.request<StepExecution>(
      "POST",
      `/api/executions/${executionId}/steps`,
      params
    );
  }

  async listStepExecutions(executionId: string): Promise<StepExecution[]> {
    return this.request<StepExecution[]>(
      "GET",
      `/api/executions/${executionId}/steps`
    );
  }

  async updateStepExecution(
    executionId: string,
    stepId: string,
    params: { status: string; error_message?: string }
  ): Promise<StepExecution> {
    return this.request<StepExecution>(
      "PATCH",
      `/api/executions/${executionId}/steps/${stepId}`,
      params
    );
  }

  // Artifacts
  async uploadArtifact(
    stepExecutionId: string,
    type: string,
    content: Buffer | string,
    filename: string,
    contentType: string,
    metadata?: Record<string, unknown>
  ): Promise<Artifact> {
    if (this.socketPath) {
      return this.uploadArtifactViaSocket(
        stepExecutionId,
        type,
        content,
        filename,
        contentType,
        metadata
      );
    }

    const url = `${this.baseURL}/api/artifacts`;
    const formData = new FormData();
    formData.append("step_execution_id", stepExecutionId);
    formData.append("type", type);
    const blob = new Blob([content], { type: contentType });
    formData.append("file", blob, filename);
    if (metadata) {
      formData.append("metadata", JSON.stringify(metadata));
    }

    const uploadHeaders: Record<string, string> = {};
    if (this.apiKey) {
      uploadHeaders["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (this.projectKey) {
      uploadHeaders["X-Project-Key"] = this.projectKey;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: uploadHeaders,
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(
        `API error ${res.status}: ${(error as { error: string }).error}`
      );
    }

    return res.json() as Promise<Artifact>;
  }

  private async uploadArtifactViaSocket(
    stepExecutionId: string,
    type: string,
    content: Buffer | string,
    filename: string,
    contentType: string,
    metadata?: Record<string, unknown>
  ): Promise<Artifact> {
    const { request } = await import("node:http");
    const boundary = `----AquaDesktop${Date.now()}`;
    const contentBuf = typeof content === "string" ? Buffer.from(content) : content;

    // Build multipart body
    const parts: Buffer[] = [];
    const addField = (name: string, value: string) => {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      ));
    };
    addField("step_execution_id", stepExecutionId);
    addField("type", type);
    if (metadata) {
      addField("metadata", JSON.stringify(metadata));
    }
    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
    ));
    parts.push(contentBuf);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    return new Promise<Artifact>((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socketPath!,
          path: "/api/artifacts",
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length.toString(),
          },
          timeout: 60000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const responseBody = Buffer.concat(chunks).toString("utf-8");
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`API error ${res.statusCode}: ${responseBody}`));
              return;
            }
            resolve(JSON.parse(responseBody) as Artifact);
          });
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  async getArtifact(id: string): Promise<Artifact> {
    return this.request<Artifact>("GET", `/api/artifacts/${id}`);
  }

  async listArtifacts(stepExecutionId: string): Promise<Artifact[]> {
    return this.request<Artifact[]>(
      "GET",
      `/api/artifacts?step_execution_id=${stepExecutionId}`
    );
  }

  // Assertion Results
  async createAssertionResults(
    results: Array<{
      step_execution_id: string;
      assertion_type: string;
      expected?: string;
      actual?: string;
      passed: boolean;
      message?: string;
      step_assertion_id?: string;
    }>
  ): Promise<AssertionResult[]> {
    return this.request<AssertionResult[]>("POST", "/api/assertions", {
      results,
    });
  }

  async listAssertionResults(params: {
    step_execution_id?: string;
    execution_id?: string;
  }): Promise<AssertionResult[]> {
    const query = new URLSearchParams();
    if (params.step_execution_id)
      query.set("step_execution_id", params.step_execution_id);
    if (params.execution_id)
      query.set("execution_id", params.execution_id);
    const qs = query.toString();
    return this.request<AssertionResult[]>(
      "GET",
      `/api/assertions${qs ? `?${qs}` : ""}`
    );
  }

  // Organizations
  async getMe(): Promise<User> {
    return this.request<User>("GET", "/api/me");
  }

  async listOrganizations(): Promise<Organization[]> {
    return this.request<Organization[]>("GET", "/api/organizations");
  }

  async createOrganization(params: {
    name: string;
  }): Promise<Organization> {
    return this.request<Organization>("POST", "/api/organizations", params);
  }

  async getOrganization(id: string): Promise<Organization> {
    return this.request<Organization>("GET", `/api/organizations/${id}`);
  }

  // Projects
  async listProjects(organizationId: string): Promise<Project[]> {
    return this.request<Project[]>(
      "GET",
      `/api/projects?organization_id=${organizationId}`
    );
  }

  async createProject(params: {
    organization_id: string;
    name: string;
    description?: string;
    repository_url?: string;
  }): Promise<Project> {
    return this.request<Project>("POST", "/api/projects", params);
  }

  async getProject(id: string): Promise<Project> {
    return this.request<Project>("GET", `/api/projects/${id}`);
  }

  async resolveProject(): Promise<ResolveProjectResponse> {
    return this.request<ResolveProjectResponse>("GET", "/api/projects/resolve");
  }

  async getProjectMemory(projectId?: string): Promise<{ content: string }> {
    if (projectId) {
      return this.request<{ content: string }>(
        "GET",
        `/api/projects/${projectId}/memory`
      );
    }
    return this.request<{ content: string }>("GET", "/api/project/memory");
  }

  async updateProjectMemory(
    content: string,
    projectId?: string
  ): Promise<{ content: string }> {
    if (projectId) {
      return this.request<{ content: string }>(
        "PUT",
        `/api/projects/${projectId}/memory`,
        { content }
      );
    }
    return this.request<{ content: string }>("PUT", "/api/project/memory", {
      content,
    });
  }

  async transferProject(
    id: string,
    targetOrganizationId: string
  ): Promise<Project> {
    return this.request<Project>("POST", `/api/projects/${id}/transfer`, {
      target_organization_id: targetOrganizationId,
    });
  }

  // Common Scenarios
  async createCommonScenario(params: {
    name: string;
    description?: string;
    requires?: string[];
    steps: Array<{
      step_key: string;
      action: string;
      config: Record<string, unknown>;
      assertions?: Array<Record<string, unknown>>;
      extract?: Record<string, string>;
      depends_on?: string[];
    }>;
  }): Promise<CommonScenario> {
    return this.request<CommonScenario>("POST", "/api/common-scenarios", params);
  }

  async getCommonScenario(id: string): Promise<CommonScenario> {
    return this.request<CommonScenario>("GET", `/api/common-scenarios/${id}`);
  }

  async listCommonScenarios(): Promise<CommonScenario[]> {
    return this.request<CommonScenario[]>("GET", "/api/common-scenarios");
  }

  async updateCommonScenario(
    id: string,
    params: {
      name?: string;
      description?: string;
      requires?: string[];
      steps?: Array<{
        step_key: string;
        action: string;
        config: Record<string, unknown>;
        assertions?: Array<Record<string, unknown>>;
        extract?: Record<string, string>;
        depends_on?: string[];
      }>;
    }
  ): Promise<CommonScenario> {
    return this.request<CommonScenario>("PUT", `/api/common-scenarios/${id}`, params);
  }

  async deleteCommonScenario(id: string): Promise<void> {
    return this.request<void>("DELETE", `/api/common-scenarios/${id}`);
  }

  // Exchange Token (API key → Web session)
  async createExchangeToken(): Promise<{
    token: string;
    browser_url: string;
  }> {
    return this.request<{ token: string; browser_url: string }>(
      "POST",
      "/api/auth/exchange-token"
    );
  }

}

export interface PatchOperation {
  op: string;
  step_key?: string;
  scenario_name?: string;
  after_step_key?: string;
  action?: string;
  config?: Record<string, unknown>;
  assertions?: Array<Record<string, unknown>>;
  extract?: Record<string, string>;
  depends_on?: string[];
  step?: {
    step_key: string;
    action: string;
    config: Record<string, unknown>;
    assertions?: Array<Record<string, unknown>>;
    extract?: Record<string, string>;
    depends_on?: string[];
  };
  scenario?: {
    name: string;
    steps: Array<{
      step_key: string;
      action: string;
      config: Record<string, unknown>;
      assertions?: Array<Record<string, unknown>>;
      extract?: Record<string, string>;
      depends_on?: string[];
    }>;
  };
}
