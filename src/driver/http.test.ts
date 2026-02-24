import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpDriver } from "./http.js";
import { ProxyAgent } from "undici";
import type { Step } from "../qa-plan/types.js";

vi.mock("undici", () => ({
  ProxyAgent: vi.fn(),
}));

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

  it("passes through step_assertion_id from assertion definition to result", async () => {
    mockFetch.mockReturnValue(successResponse("{}", 200));

    const step = httpStep({
      assertions: [
        {
          type: "status_code",
          expected: 200,
          id: "ast_abc123",
          description: "API returns success",
        } as never,
      ],
    });
    const result = await driver.execute(step, {});

    expect(result.assertionResults?.[0].passed).toBe(true);
    expect(result.assertionResults?.[0].step_assertion_id).toBe("ast_abc123");
  });

  it("omits step_assertion_id when not set on assertion", async () => {
    mockFetch.mockReturnValue(successResponse("{}", 200));

    const step = httpStep({
      assertions: [{ type: "status_code", expected: 200 }],
    });
    const result = await driver.execute(step, {});

    expect(result.assertionResults?.[0].passed).toBe(true);
    expect(result.assertionResults?.[0].step_assertion_id).toBeUndefined();
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

    it("passes requestTls with ca when caCert is provided", () => {
      const caCert = Buffer.from("test-ca-cert");
      new HttpDriver({
        server: "http://proxy.example.com:3128",
        caCert,
      });

      expect(ProxyAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          requestTls: expect.objectContaining({ ca: caCert }),
        }),
      );
    });

    it("passes proxyTls with ca when proxyCaCert is provided", () => {
      const proxyCaCert = Buffer.from("test-proxy-ca-cert");
      new HttpDriver({
        server: "https://proxy.example.com:3128",
        proxyCaCert,
      });

      expect(ProxyAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          proxyTls: expect.objectContaining({ ca: proxyCaCert }),
        }),
      );
    });

    it("passes rejectUnauthorized to both requestTls and proxyTls", () => {
      new HttpDriver({
        server: "http://proxy.example.com:3128",
        rejectUnauthorized: false,
      });

      expect(ProxyAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          requestTls: expect.objectContaining({ rejectUnauthorized: false }),
          proxyTls: expect.objectContaining({ rejectUnauthorized: false }),
        }),
      );
    });

    it("uses separate CA certs for requestTls and proxyTls", () => {
      const caCert = Buffer.from("target-ca");
      const proxyCaCert = Buffer.from("proxy-ca");
      new HttpDriver({
        server: "https://proxy.example.com:3128",
        caCert,
        proxyCaCert,
      });

      expect(ProxyAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          requestTls: expect.objectContaining({ ca: caCert }),
          proxyTls: expect.objectContaining({ ca: proxyCaCert }),
        }),
      );
    });

    it("does not set TLS options when not configured", () => {
      new HttpDriver({
        server: "http://proxy.example.com:3128",
      });

      const args = vi.mocked(ProxyAgent).mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(args.requestTls).toBeUndefined();
      expect(args.proxyTls).toBeUndefined();
    });
  });
});
