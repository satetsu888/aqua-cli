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
  execution: QuotaStatusEntry;
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
  slug: string;
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

  constructor(baseURL: string, apiKey?: string | null, projectKey?: string | null) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.apiKey = apiKey ?? null;
    this.projectKey = projectKey ?? null;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
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
    limit?: number;
    cursor?: string;
  }): Promise<{ items: QAPlan[]; next_cursor: string | null }> {
    const query = new URLSearchParams();
    if (params?.project_id) query.set("project_id", params.project_id);
    if (params?.status) query.set("status", params.status);
    if (params?.pinned !== undefined) query.set("pinned", String(params.pinned));
    if (params?.include_archived) query.set("include_archived", "true");
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
    slug: string;
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
