import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HttpDriver,
  normalizeBody,
  buildBody,
  buildAuthHeader,
  buildWireHeaders,
} from "./http.js";
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

  function successResponse(
    body: string | Uint8Array,
    status = 200,
    contentType: string = "application/json"
  ) {
    const headers = new Map<string, string>();
    headers.set("content-type", contentType);
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : body;
    // Single-chunk ReadableStream so HttpDriver.readResponseBody can consume it.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return Promise.resolve({
      status,
      body: stream,
      headers: {
        forEach: (cb: (value: string, key: string) => void) => {
          headers.forEach((v, k) => cb(v, k));
        },
        // Used by HttpDriver in readResponseBody fallback paths; not strictly
        // needed but harmless.
        get: (name: string) => headers.get(name.toLowerCase()) ?? null,
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

  describe("response body handling", () => {
    it("decodes text response and fills sha256/size", async () => {
      mockFetch.mockReturnValue(
        successResponse('{"ok":true}', 200, "application/json")
      );
      const result = await driver.execute(httpStep(), {});
      expect(result.response?.is_binary).toBe(false);
      expect(result.response?.body).toBe('{"ok":true}');
      expect(result.response?.body_size).toBe(11);
      expect(result.response?.body_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.response?.content_type).toBe("application/json");
      expect(result.response?.body_bytes).toBeUndefined();
    });

    it("treats application/octet-stream as binary", async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      mockFetch.mockReturnValue(
        successResponse(bytes, 200, "application/octet-stream")
      );
      const result = await driver.execute(httpStep(), {});
      expect(result.response?.is_binary).toBe(true);
      expect(result.response?.body).toBe("");
      expect(result.response?.body_size).toBe(6);
      expect(result.response?.body_bytes).toBeDefined();
      expect(
        Buffer.compare(result.response!.body_bytes!, Buffer.from(bytes))
      ).toBe(0);
    });

    it("treats image/png as binary", async () => {
      mockFetch.mockReturnValue(
        successResponse(new Uint8Array([1, 2, 3]), 200, "image/png")
      );
      const result = await driver.execute(httpStep(), {});
      expect(result.response?.is_binary).toBe(true);
    });

    it("treats application/vnd.api+json as text (vendor JSON)", async () => {
      mockFetch.mockReturnValue(
        successResponse('{"a":1}', 200, "application/vnd.api+json")
      );
      const result = await driver.execute(httpStep(), {});
      expect(result.response?.is_binary).toBe(false);
      expect(result.response?.body).toBe('{"a":1}');
    });

    it("honors response_body: 'binary' override", async () => {
      // Even though Content-Type says JSON, force binary handling.
      mockFetch.mockReturnValue(successResponse('{"x":1}', 200, "application/json"));
      const step = httpStep({
        config: {
          method: "GET",
          url: "http://x/",
          response_body: "binary",
        },
      });
      const result = await driver.execute(step, {});
      expect(result.response?.is_binary).toBe(true);
      expect(result.response?.body).toBe("");
    });

    it("honors response_body: 'text' override for octet-stream", async () => {
      mockFetch.mockReturnValue(
        successResponse("hello", 200, "application/octet-stream")
      );
      const step = httpStep({
        config: {
          method: "GET",
          url: "http://x/",
          response_body: "text",
        },
      });
      const result = await driver.execute(step, {});
      expect(result.response?.is_binary).toBe(false);
      expect(result.response?.body).toBe("hello");
    });

    it("truncates body when max_response_body_size is exceeded", async () => {
      const big = new Uint8Array(100); // 100 bytes
      mockFetch.mockReturnValue(
        successResponse(big, 200, "application/octet-stream")
      );
      const step = httpStep({
        config: {
          method: "GET",
          url: "http://x/",
          max_response_body_size: 40,
        },
      });
      const result = await driver.execute(step, {});
      expect(result.response?.body_truncated).toBe(true);
      expect(result.response?.body_size).toBe(40);
    });
  });

  describe("auth", () => {
    describe("basic", () => {
      it("sends Authorization: Basic <base64(user:pass)>", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "GET",
              url: "http://x/",
              auth: { type: "basic", username: "alice", password: "s3cret" },
            },
          }),
          {}
        );
        const opts = mockFetch.mock.calls[0][1];
        expect(opts.headers).toEqual({
          Authorization: `Basic ${Buffer.from("alice:s3cret").toString("base64")}`,
        });
      });

      it("expands {{variable}} templates in username and password", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "GET",
              url: "http://x/",
              auth: {
                type: "basic",
                username: "{{api_user}}",
                password: "{{api_password}}",
              },
            },
          }),
          { api_user: "admin", api_password: "p@ss w0rd" }
        );
        const opts = mockFetch.mock.calls[0][1];
        expect(opts.headers).toEqual({
          Authorization: `Basic ${Buffer.from("admin:p@ss w0rd").toString("base64")}`,
        });
      });

      it("merges explicit headers with the generated Authorization (no conflict)", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "GET",
              url: "http://x/",
              headers: { "X-Trace-Id": "abc" },
              auth: { type: "basic", username: "u", password: "p" },
            },
          }),
          {}
        );
        const opts = mockFetch.mock.calls[0][1];
        expect(opts.headers).toEqual({
          Authorization: `Basic ${Buffer.from("u:p").toString("base64")}`,
          "X-Trace-Id": "abc",
        });
      });
    });

    describe("bearer", () => {
      it("sends Authorization: Bearer <token>", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "GET",
              url: "http://x/",
              auth: { type: "bearer", token: "tok-xyz" },
            },
          }),
          {}
        );
        const opts = mockFetch.mock.calls[0][1];
        expect(opts.headers).toEqual({ Authorization: "Bearer tok-xyz" });
      });

      it("expands template in token", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "GET",
              url: "http://x/",
              auth: { type: "bearer", token: "{{access_token}}" },
            },
          }),
          { access_token: "ey.signed" }
        );
        const opts = mockFetch.mock.calls[0][1];
        expect(opts.headers).toEqual({ Authorization: "Bearer ey.signed" });
      });
    });

    describe("conflict with explicit Authorization header", () => {
      it("sends BOTH Authorization headers as array-of-tuples", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "GET",
              url: "http://x/",
              headers: {
                Authorization: "Bearer explicit-tok",
                "X-Trace-Id": "abc",
              },
              auth: { type: "basic", username: "u", password: "p" },
            },
          }),
          {}
        );
        const opts = mockFetch.mock.calls[0][1];
        // headers must be array-of-tuples so fetch preserves both Authorization values
        expect(Array.isArray(opts.headers)).toBe(true);
        const tuples = opts.headers as [string, string][];
        const authValues = tuples
          .filter(([k]) => k.toLowerCase() === "authorization")
          .map(([, v]) => v);
        expect(authValues).toHaveLength(2);
        expect(authValues).toContain(
          `Basic ${Buffer.from("u:p").toString("base64")}`
        );
        expect(authValues).toContain("Bearer explicit-tok");
        // Non-Authorization headers are preserved
        expect(tuples).toContainEqual(["X-Trace-Id", "abc"]);
      });

      it("detects existing Authorization case-insensitively", async () => {
        mockFetch.mockReturnValue(successResponse("{}"));
        await driver.execute(
          httpStep({
            config: {
              method: "GET",
              url: "http://x/",
              headers: { authorization: "Bearer lower" },
              auth: { type: "basic", username: "u", password: "p" },
            },
          }),
          {}
        );
        const opts = mockFetch.mock.calls[0][1];
        expect(Array.isArray(opts.headers)).toBe(true);
      });
    });

    it("does not set Authorization when auth is omitted (existing behavior)", async () => {
      mockFetch.mockReturnValue(successResponse("{}"));
      await driver.execute(httpStep(), {});
      const opts = mockFetch.mock.calls[0][1];
      // headers remains undefined / plain when no auth and no explicit headers
      expect(opts.headers).toBeUndefined();
    });
  });

  describe("buildAuthHeader direct", () => {
    it("returns undefined for undefined auth", () => {
      expect(buildAuthHeader(undefined)).toBeUndefined();
    });

    it("builds basic", () => {
      expect(buildAuthHeader({ type: "basic", username: "a", password: "b" }))
        .toBe(`Basic ${Buffer.from("a:b").toString("base64")}`);
    });

    it("builds bearer", () => {
      expect(buildAuthHeader({ type: "bearer", token: "tk" })).toBe(
        "Bearer tk"
      );
    });
  });

  describe("buildWireHeaders direct", () => {
    it("passes explicit through when no auth header", () => {
      expect(buildWireHeaders({ "X-A": "1" }, undefined)).toEqual({ "X-A": "1" });
      expect(buildWireHeaders(undefined, undefined)).toBeUndefined();
    });

    it("merges plain object when no Authorization conflict", () => {
      expect(buildWireHeaders({ "X-A": "1" }, "Basic xxx")).toEqual({
        Authorization: "Basic xxx",
        "X-A": "1",
      });
    });

    it("returns array-of-tuples with both Authorization headers on conflict", () => {
      const out = buildWireHeaders(
        { Authorization: "Bearer e", "X-A": "1" },
        "Basic g"
      );
      expect(Array.isArray(out)).toBe(true);
      expect(out as [string, string][]).toEqual([
        ["Authorization", "Basic g"],
        ["Authorization", "Bearer e"],
        ["X-A", "1"],
      ]);
    });
  });

  describe("new assertions", () => {
    describe("header assertion", () => {
      it("equals (default) — pass when value matches case-insensitively", async () => {
        mockFetch.mockReturnValue(successResponse("{}", 200, "application/json"));
        const step = httpStep({
          assertions: [
            { type: "header", name: "Content-Type", expected: "application/json" },
          ],
        });
        const result = await driver.execute(step, {});
        expect(result.assertionResults?.[0].passed).toBe(true);
      });

      it("equals — fail when missing", async () => {
        mockFetch.mockReturnValue(successResponse("{}", 200, "application/json"));
        const step = httpStep({
          assertions: [
            { type: "header", name: "X-Custom", expected: "yes" } as never,
          ],
        });
        const result = await driver.execute(step, {});
        expect(result.assertionResults?.[0].passed).toBe(false);
        expect(result.assertionResults?.[0].actual).toBe("<missing>");
      });

      it("contains", async () => {
        mockFetch.mockReturnValue(
          successResponse("{}", 200, "application/json; charset=utf-8")
        );
        const step = httpStep({
          assertions: [
            { type: "header", name: "content-type", condition: "contains", expected: "charset" } as never,
          ],
        });
        expect((await driver.execute(step, {})).assertionResults?.[0].passed).toBe(true);
      });

      it("exists / not_exists", async () => {
        mockFetch.mockReturnValue(successResponse("{}", 200, "application/json"));
        const step = httpStep({
          assertions: [
            { type: "header", name: "content-type", condition: "exists" } as never,
            { type: "header", name: "x-nope", condition: "not_exists" } as never,
          ],
        });
        const result = await driver.execute(step, {});
        expect(result.assertionResults?.[0].passed).toBe(true);
        expect(result.assertionResults?.[1].passed).toBe(true);
      });

      it("matches regex", async () => {
        mockFetch.mockReturnValue(
          successResponse("{}", 200, "application/json; charset=utf-8")
        );
        const step = httpStep({
          assertions: [
            { type: "header", name: "content-type", condition: "matches", expected: "^application/json" } as never,
          ],
        });
        expect((await driver.execute(step, {})).assertionResults?.[0].passed).toBe(true);
      });
    });

    describe("body_size assertion", () => {
      it("equals", async () => {
        mockFetch.mockReturnValue(successResponse("12345", 200, "text/plain"));
        const step = httpStep({
          assertions: [{ type: "body_size", expected: 5 } as never],
        });
        const result = await driver.execute(step, {});
        expect(result.assertionResults?.[0].passed).toBe(true);
      });

      it("between", async () => {
        mockFetch.mockReturnValue(successResponse("0123456789", 200, "text/plain"));
        const step = httpStep({
          assertions: [
            { type: "body_size", condition: "between", expected: [5, 20] } as never,
          ],
        });
        expect((await driver.execute(step, {})).assertionResults?.[0].passed).toBe(true);
      });

      it("greater_than fail", async () => {
        mockFetch.mockReturnValue(successResponse("ab", 200, "text/plain"));
        const step = httpStep({
          assertions: [
            { type: "body_size", condition: "greater_than", expected: 100 } as never,
          ],
        });
        expect((await driver.execute(step, {})).assertionResults?.[0].passed).toBe(false);
      });
    });

    describe("body_hash assertion", () => {
      it("sha256 (default) on text response", async () => {
        // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        mockFetch.mockReturnValue(successResponse("hello", 200, "text/plain"));
        const step = httpStep({
          assertions: [
            {
              type: "body_hash",
              expected:
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            } as never,
          ],
        });
        expect((await driver.execute(step, {})).assertionResults?.[0].passed).toBe(true);
      });

      it("md5", async () => {
        // md5("hello") = 5d41402abc4b2a76b9719d911017c592
        mockFetch.mockReturnValue(successResponse("hello", 200, "text/plain"));
        const step = httpStep({
          assertions: [
            {
              type: "body_hash",
              algorithm: "md5",
              expected: "5d41402abc4b2a76b9719d911017c592",
            } as never,
          ],
        });
        expect((await driver.execute(step, {})).assertionResults?.[0].passed).toBe(true);
      });

      it("sha256 on binary response", async () => {
        mockFetch.mockReturnValue(
          successResponse(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), 200, "application/octet-stream")
        );
        const step = httpStep({
          assertions: [
            // sha256(deadbeef) = 5f78c33274e43fa9de5659265c1d917e25c03722dcb0b8d27db8d5feaa813953
            {
              type: "body_hash",
              expected:
                "5f78c33274e43fa9de5659265c1d917e25c03722dcb0b8d27db8d5feaa813953",
            } as never,
          ],
        });
        expect((await driver.execute(step, {})).assertionResults?.[0].passed).toBe(true);
      });
    });

    describe("body_contains assertion", () => {
      it("passes when substring present in text body", async () => {
        mockFetch.mockReturnValue(
          successResponse("<html><body>welcome user</body></html>", 200, "text/html")
        );
        const step = httpStep({
          assertions: [{ type: "body_contains", expected: "welcome user" } as never],
        });
        expect((await driver.execute(step, {})).assertionResults?.[0].passed).toBe(true);
      });

      it("fails on binary response with explicit message", async () => {
        mockFetch.mockReturnValue(
          successResponse(new Uint8Array([1, 2, 3]), 200, "application/octet-stream")
        );
        const step = httpStep({
          assertions: [{ type: "body_contains", expected: "x" } as never],
        });
        const result = await driver.execute(step, {});
        expect(result.assertionResults?.[0].passed).toBe(false);
        expect(result.assertionResults?.[0].message).toMatch(/binary response body/);
      });
    });

    describe("json_path on binary", () => {
      it("fails with explicit message", async () => {
        mockFetch.mockReturnValue(
          successResponse(new Uint8Array([1, 2, 3]), 200, "application/octet-stream")
        );
        const step = httpStep({
          assertions: [
            { type: "json_path", path: "$.a", condition: "exists" } as never,
          ],
        });
        const result = await driver.execute(step, {});
        expect(result.assertionResults?.[0].passed).toBe(false);
        expect(result.assertionResults?.[0].message).toMatch(/binary response body/);
      });
    });
  });
});
