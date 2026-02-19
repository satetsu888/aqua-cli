import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpDriver } from "./http.js";
import type { Step } from "../qa-plan/types.js";

describe("HttpDriver", () => {
  const driver = new HttpDriver();
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  function httpStep(overrides: Partial<Step> = {}): Step {
    return {
      id: "server-id-1",
      step_key: "test-step",
      action: "http_request",
      config: {
        method: "GET",
        url: "http://example.com/api",
      },
      sort_order: 0,
      ...overrides,
    } as Step;
  }

  function successResponse(body: string, status = 200) {
    const headers = new Map<string, string>();
    headers.set("content-type", "application/json");
    return Promise.resolve({
      status,
      text: () => Promise.resolve(body),
      headers: {
        forEach: (cb: (value: string, key: string) => void) => {
          headers.forEach((v, k) => cb(v, k));
        },
      },
    });
  }

  it("executes successful GET request", async () => {
    mockFetch.mockReturnValue(
      successResponse(JSON.stringify({ message: "ok" }))
    );

    const result = await driver.execute(httpStep(), {});

    expect(result.status).toBe("passed");
    expect(result.response?.status).toBe(200);
    expect(result.response?.body).toContain("ok");
  });

  it("evaluates status_code assertion - pass", async () => {
    mockFetch.mockReturnValue(successResponse("{}", 200));

    const step = httpStep({
      assertions: [{ type: "status_code", expected: 200 }],
    });
    const result = await driver.execute(step, {});

    expect(result.status).toBe("passed");
    expect(result.assertionResults?.[0].passed).toBe(true);
  });

  it("evaluates status_code assertion - fail", async () => {
    mockFetch.mockReturnValue(successResponse("{}", 404));

    const step = httpStep({
      assertions: [{ type: "status_code", expected: 200 }],
    });
    const result = await driver.execute(step, {});

    expect(result.status).toBe("failed");
    expect(result.assertionResults?.[0].passed).toBe(false);
  });

  it("evaluates status_code_in assertion - pass", async () => {
    mockFetch.mockReturnValue(successResponse("{}", 201));

    const step = httpStep({
      assertions: [{ type: "status_code_in", expected: [200, 201, 409] }],
    });
    const result = await driver.execute(step, {});

    expect(result.status).toBe("passed");
    expect(result.assertionResults?.[0].passed).toBe(true);
    expect(result.assertionResults?.[0].expected).toBe("200, 201, 409");
    expect(result.assertionResults?.[0].actual).toBe("201");
  });

  it("evaluates status_code_in assertion - fail", async () => {
    mockFetch.mockReturnValue(successResponse("{}", 500));

    const step = httpStep({
      assertions: [{ type: "status_code_in", expected: [200, 201, 409] }],
    });
    const result = await driver.execute(step, {});

    expect(result.status).toBe("failed");
    expect(result.assertionResults?.[0].passed).toBe(false);
    expect(result.assertionResults?.[0].message).toContain(
      "one of [200, 201, 409]"
    );
  });

  it("evaluates json_path equals assertion", async () => {
    mockFetch.mockReturnValue(
      successResponse(JSON.stringify({ data: { name: "test" } }))
    );

    const step = httpStep({
      assertions: [
        { type: "json_path", path: "$.data.name", expected: "test" },
      ],
    });
    const result = await driver.execute(step, {});

    expect(result.assertionResults?.[0].passed).toBe(true);
  });

  it("evaluates json_path exists assertion", async () => {
    mockFetch.mockReturnValue(
      successResponse(JSON.stringify({ data: { id: 1 } }))
    );

    const step = httpStep({
      assertions: [
        { type: "json_path", path: "$.data.id", condition: "exists" },
      ],
    });
    const result = await driver.execute(step, {});

    expect(result.assertionResults?.[0].passed).toBe(true);
  });

  it("evaluates json_path contains assertion", async () => {
    mockFetch.mockReturnValue(
      successResponse(JSON.stringify({ msg: "hello world" }))
    );

    const step = httpStep({
      assertions: [
        {
          type: "json_path",
          path: "$.msg",
          condition: "contains",
          expected: "world",
        },
      ],
    });
    const result = await driver.execute(step, {});

    expect(result.assertionResults?.[0].passed).toBe(true);
  });

  it("extracts values from response", async () => {
    mockFetch.mockReturnValue(
      successResponse(JSON.stringify({ token: "abc123" }))
    );

    const step = httpStep({
      extract: { auth_token: "$.token" },
    });
    const result = await driver.execute(step, {});

    expect(result.extractedValues).toEqual({ auth_token: "abc123" });
  });

  it("returns error status on fetch failure", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await driver.execute(httpStep(), {});

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Network error");
  });

  it("expands template variables in config", async () => {
    mockFetch.mockReturnValue(successResponse("{}"));

    const step = httpStep({
      config: {
        method: "GET",
        url: "{{api_base_url}}/users",
      },
    });
    await driver.execute(step, { api_base_url: "http://localhost:3000" });

    expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:3000/users");
  });

  describe("proxy support", () => {
    it("passes dispatcher to fetch when proxy is configured", async () => {
      const proxyDriver = new HttpDriver({
        server: "http://proxy.example.com:3128",
      });
      mockFetch.mockReturnValue(successResponse("{}"));

      await proxyDriver.execute(httpStep(), {});

      expect(mockFetch).toHaveBeenCalled();
      const fetchOpts = mockFetch.mock.calls[0][1];
      expect(fetchOpts.dispatcher).toBeDefined();
    });

    it("does not set dispatcher when no proxy configured", async () => {
      const noProxyDriver = new HttpDriver();
      mockFetch.mockReturnValue(successResponse("{}"));

      await noProxyDriver.execute(httpStep(), {});

      const fetchOpts = mockFetch.mock.calls[0][1];
      expect(fetchOpts.dispatcher).toBeUndefined();
    });

    it("creates ProxyAgent with auth token when credentials provided", async () => {
      const proxyDriver = new HttpDriver({
        server: "http://proxy.example.com:3128",
        username: "user",
        password: "pass",
      });
      mockFetch.mockReturnValue(successResponse("{}"));

      await proxyDriver.execute(httpStep(), {});

      const fetchOpts = mockFetch.mock.calls[0][1];
      expect(fetchOpts.dispatcher).toBeDefined();
    });
  });
});
