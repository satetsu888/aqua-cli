import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpDriver, normalizeBody, buildBody } from "./http.js";
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

    it("does not set dispatcher when URL matches bypass pattern", async () => {
      const proxyDriver = new HttpDriver({
        server: "http://proxy.example.com:3128",
        bypass: "localhost,.internal.com",
      });
      mockFetch.mockReturnValue(successResponse("{}"));

      const step = httpStep({
        config: { method: "GET", url: "http://localhost:8080/api" },
      });
      await proxyDriver.execute(step, {});

      const fetchOpts = mockFetch.mock.calls[0][1];
      expect(fetchOpts.dispatcher).toBeUndefined();
    });

    it("sets dispatcher when URL does not match bypass pattern", async () => {
      const proxyDriver = new HttpDriver({
        server: "http://proxy.example.com:3128",
        bypass: "localhost,.internal.com",
      });
      mockFetch.mockReturnValue(successResponse("{}"));

      const step = httpStep({
        config: { method: "GET", url: "http://external.example.com/api" },
      });
      await proxyDriver.execute(step, {});

      const fetchOpts = mockFetch.mock.calls[0][1];
      expect(fetchOpts.dispatcher).toBeDefined();
    });

    it("bypasses proxy for suffix-matched domains", async () => {
      const proxyDriver = new HttpDriver({
        server: "http://proxy.example.com:3128",
        bypass: ".internal.com",
      });
      mockFetch.mockReturnValue(successResponse("{}"));

      const step = httpStep({
        config: { method: "GET", url: "http://api.internal.com/data" },
      });
      await proxyDriver.execute(step, {});

      const fetchOpts = mockFetch.mock.calls[0][1];
      expect(fetchOpts.dispatcher).toBeUndefined();
    });
  });

  describe("request body", () => {
    it("sends nothing when body is omitted", async () => {
      mockFetch.mockReturnValue(successResponse("{}"));
      await driver.execute(httpStep({ config: { method: "POST", url: "http://x/" } }), {});
      const opts = mockFetch.mock.calls[0][1];
      expect(opts.body).toBeUndefined();
    });

    it("does NOT auto-inject Content-Type for any body type", async () => {
      // json
      mockFetch.mockReturnValue(successResponse("{}"));
      await driver.execute(
        httpStep({
          config: {
            method: "POST",
            url: "http://x/",
            body: { type: "json", value: { a: 1 } },
          },
        }),
        {}
      );
      let opts = mockFetch.mock.calls[0][1];
      expect(opts.headers).toBeUndefined();

      // form
      mockFetch.mockReturnValue(successResponse("{}"));
      await driver.execute(
        httpStep({
          config: {
            method: "POST",
            url: "http://x/",
            body: { type: "form", fields: { a: "1" } },
          },
        }),
        {}
      );
      opts = mockFetch.mock.calls[1][1];
      expect(opts.headers).toBeUndefined();
    });

    it("sends user-specified headers as-is", async () => {
      mockFetch.mockReturnValue(successResponse("{}"));
      await driver.execute(
        httpStep({
          config: {
            method: "POST",
            url: "http://x/",
            headers: { "Content-Type": "application/vnd.api+json", "X-Foo": "bar" },
            body: { type: "json", value: { a: 1 } },
          },
        }),
        {}
      );
      const opts = mockFetch.mock.calls[0][1];
      expect(opts.headers).toEqual({
        "Content-Type": "application/vnd.api+json",
        "X-Foo": "bar",
      });
    });

    describe("json body", () => {
      it("serializes object via JSON.stringify", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: { type: "json", value: { name: "test", n: 42 } },
            },
          }),
          {}
        );
        const opts = mockFetch.mock.calls[0][1];
        expect(opts.body).toBe('{"name":"test","n":42}');
      });

      it("serializes array and primitive values", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: { type: "json", value: [1, 2, 3] },
            },
          }),
          {}
        );
        expect(mockFetch.mock.calls[0][1].body).toBe("[1,2,3]");
      });

      it("expands {{variable}} inside json value", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: { type: "json", value: { token: "{{token}}" } },
            },
          }),
          { token: "secret-xyz" }
        );
        expect(mockFetch.mock.calls[0][1].body).toBe('{"token":"secret-xyz"}');
      });
    });

    describe("form body", () => {
      it("URL-encodes fields and returns a plain string", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: { type: "form", fields: { name: "alice bob", age: "30" } },
            },
          }),
          {}
        );
        const body = mockFetch.mock.calls[0][1].body;
        // string (not URLSearchParams instance) so undici does not auto-set Content-Type
        expect(typeof body).toBe("string");
        expect(body).toBe("name=alice+bob&age=30");
      });

      it("expands templates in form fields", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: { type: "form", fields: { email: "{{email}}" } },
            },
          }),
          { email: "a@b.example" }
        );
        expect(mockFetch.mock.calls[0][1].body).toBe("email=a%40b.example");
      });
    });

    describe("text body", () => {
      it("sends raw string unchanged", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        const xml = "<note><to>Tove</to></note>";
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              headers: { "Content-Type": "application/xml" },
              body: { type: "text", value: xml },
            },
          }),
          {}
        );
        expect(mockFetch.mock.calls[0][1].body).toBe(xml);
      });
    });

    describe("binary body", () => {
      it("decodes content_base64 to Buffer", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: {
                type: "binary",
                content_base64: bytes.toString("base64"),
              },
            },
          }),
          {}
        );
        const body = mockFetch.mock.calls[0][1].body;
        expect(Buffer.isBuffer(body)).toBe(true);
        expect(Buffer.compare(body, bytes)).toBe(0);
      });
    });

    describe("graphql body", () => {
      it("wraps query/variables/operationName into JSON", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/graphql",
              body: {
                type: "graphql",
                query: "query Q($id: ID!) { user(id: $id) { name } }",
                variables: { id: "u1" },
                operationName: "Q",
              },
            },
          }),
          {}
        );
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body).toEqual({
          query: "query Q($id: ID!) { user(id: $id) { name } }",
          variables: { id: "u1" },
          operationName: "Q",
        });
      });
    });

    describe("multipart body", () => {
      it("builds boundary-delimited body with user-supplied boundary", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              headers: { "Content-Type": "multipart/form-data; boundary=----b" },
              body: {
                type: "multipart",
                boundary: "----b",
                fields: { title: "hello" },
                files: [
                  {
                    name: "file",
                    content: "abc",
                    filename: "a.txt",
                    content_type: "text/plain",
                  },
                ],
              },
            },
          }),
          {}
        );
        const body = mockFetch.mock.calls[0][1].body as Buffer;
        expect(Buffer.isBuffer(body)).toBe(true);
        const text = body.toString("utf-8");
        expect(text).toContain("------b\r\n");
        expect(text).toContain('Content-Disposition: form-data; name="title"');
        expect(text).toContain("hello");
        expect(text).toContain('Content-Disposition: form-data; name="file"; filename="a.txt"');
        expect(text).toContain("Content-Type: text/plain");
        expect(text).toContain("abc");
        expect(text).toMatch(/------b--\r\n$/);
      });

      it("generates a boundary when not specified", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: {
                type: "multipart",
                fields: { a: "1" },
              },
            },
          }),
          {}
        );
        const text = (mockFetch.mock.calls[0][1].body as Buffer).toString("utf-8");
        expect(text).toMatch(/^------aqua-[a-f0-9]+\r\n/);
      });
    });

    describe("backwards compatibility", () => {
      it("treats a plain object as { type: 'json', value: ... }", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: { name: "legacy" },
            },
          }),
          {}
        );
        expect(mockFetch.mock.calls[0][1].body).toBe('{"name":"legacy"}');
      });

      it("treats a string as { type: 'text', value: string }", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: "raw text",
            },
          }),
          {}
        );
        expect(mockFetch.mock.calls[0][1].body).toBe("raw text");
      });

      it("expands templates in legacy object body", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "POST",
              url: "http://x/",
              body: { token: "{{t}}" },
            },
          }),
          { t: "ABC" }
        );
        expect(mockFetch.mock.calls[0][1].body).toBe('{"token":"ABC"}');
      });
    });
  });

  describe("normalizeBody", () => {
    it("returns undefined for null/undefined", () => {
      expect(normalizeBody(undefined)).toBeUndefined();
      expect(normalizeBody(null)).toBeUndefined();
    });

    it("passes through new format", () => {
      const b = { type: "json", value: { a: 1 } };
      expect(normalizeBody(b)).toBe(b);
    });

    it("normalizes string to text", () => {
      expect(normalizeBody("hello")).toEqual({ type: "text", value: "hello" });
    });

    it("normalizes plain object to json", () => {
      expect(normalizeBody({ a: 1 })).toEqual({ type: "json", value: { a: 1 } });
    });

    it("treats unknown type field as legacy json", () => {
      // An object whose `type` is not a known body kind is still legacy JSON,
      // so it should be wrapped, not passed through.
      const input = { type: "unknown-thing", value: 1 };
      expect(normalizeBody(input)).toEqual({ type: "json", value: input });
    });
  });

  describe("buildBody direct", () => {
    it("rejects binary without source", async () => {
      // Casting because the schema would forbid this, but the function must be safe at runtime.
      await expect(buildBody({ type: "binary" } as never)).rejects.toThrow(
        /path or content_base64/
      );
    });
  });
});
