import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AquaClient } from "./client.js";

describe("AquaClient", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  function jsonResponse(data: unknown, status = 200) {
    return Promise.resolve({
      ok: true,
      status,
      json: () => Promise.resolve(data),
      headers: new Headers(),
    });
  }

  function errorResponse(status: number, error: string) {
    return Promise.resolve({
      ok: false,
      status,
      statusText: "Error",
      json: () => Promise.resolve({ error }),
    });
  }

  it("sends GET request with correct URL and auth header", async () => {
    mockFetch.mockReturnValue(jsonResponse({ id: "p1" }));
    const client = new AquaClient("http://localhost:8080", "test-key");

    await client.getQAPlan("p1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/qa-plans/p1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );
  });

  it("sends POST request with body", async () => {
    mockFetch.mockReturnValue(jsonResponse({ id: "p1" }));
    const client = new AquaClient("http://localhost:8080", "key");

    await client.createQAPlan({
      project_id: "proj1",
      name: "Test Plan",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/qa-plans",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ project_id: "proj1", name: "Test Plan" }),
      })
    );
  });

  it("omits Authorization header when no apiKey", async () => {
    mockFetch.mockReturnValue(jsonResponse({ items: [], next_cursor: null }));
    const client = new AquaClient("http://localhost:8080");

    await client.listQAPlans();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("returns undefined for 204 response", async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 204,
        json: () => Promise.resolve(null),
      })
    );
    const client = new AquaClient("http://localhost:8080", "key");

    const result = await client.deleteQAPlan("p1");
    expect(result).toBeUndefined();
  });

  it("throws on error response", async () => {
    mockFetch.mockReturnValue(errorResponse(404, "Not found"));
    const client = new AquaClient("http://localhost:8080", "key");

    await expect(client.getQAPlan("nonexistent")).rejects.toThrow(
      "API error 404: Not found"
    );
  });

  it("strips trailing slash from baseURL", async () => {
    mockFetch.mockReturnValue(jsonResponse({ id: "p1" }));
    const client = new AquaClient("http://localhost:8080/", "key");

    await client.getQAPlan("p1");

    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://localhost:8080/api/qa-plans/p1"
    );
  });

  it("uploadArtifact sends FormData", async () => {
    mockFetch.mockReturnValue(jsonResponse({ id: "a1" }));
    const client = new AquaClient("http://localhost:8080", "key");

    await client.uploadArtifact(
      "step1",
      "http_request",
      "{}",
      "request.json",
      "application/json",
      { method: "GET" }
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/artifacts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer key",
        }),
      })
    );
    const body = mockFetch.mock.calls[0][1].body;
    expect(body).toBeInstanceOf(FormData);
  });

  it("listQAPlans builds query string", async () => {
    mockFetch.mockReturnValue(jsonResponse({ items: [], next_cursor: null }));
    const client = new AquaClient("http://localhost:8080", "key");

    await client.listQAPlans({ project_id: "proj1", status: "active" });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("project_id=proj1");
    expect(url).toContain("status=active");
  });

  it("getProjectMemory sends GET to correct URL with projectId", async () => {
    mockFetch.mockReturnValue(jsonResponse({ content: "# Memory" }));
    const client = new AquaClient("http://localhost:8080", "key");

    const result = await client.getProjectMemory("proj1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/projects/proj1/memory",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer key",
        }),
      })
    );
    expect(result).toEqual({ content: "# Memory" });
  });

  it("getProjectMemory sends GET to header-based URL without projectId", async () => {
    mockFetch.mockReturnValue(jsonResponse({ content: "# Memory" }));
    const client = new AquaClient("http://localhost:8080", "key");

    const result = await client.getProjectMemory();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/project/memory",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual({ content: "# Memory" });
  });

  it("updateProjectMemory sends PUT with content body and projectId", async () => {
    const content = "# Updated\n\nNew content";
    mockFetch.mockReturnValue(jsonResponse({ content }));
    const client = new AquaClient("http://localhost:8080", "key");

    const result = await client.updateProjectMemory(content, "proj1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/projects/proj1/memory",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ content }),
      })
    );
    expect(result).toEqual({ content });
  });

  it("updateProjectMemory sends PUT to header-based URL without projectId", async () => {
    const content = "# Updated\n\nNew content";
    mockFetch.mockReturnValue(jsonResponse({ content }));
    const client = new AquaClient("http://localhost:8080", "key");

    const result = await client.updateProjectMemory(content);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/project/memory",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ content }),
      })
    );
    expect(result).toEqual({ content });
  });

  describe("isDesktopMode", () => {
    it("returns false when no socketPath is provided", () => {
      const client = new AquaClient("http://localhost:8080", "key");
      expect(client.isDesktopMode).toBe(false);
    });

    it("returns true when socketPath is provided", () => {
      const client = new AquaClient("http://localhost", null, null, {
        socketPath: "/tmp/aqua.sock",
      });
      expect(client.isDesktopMode).toBe(true);
    });
  });

  describe("desktop mode (UDS transport)", () => {
    let mockRequest: ReturnType<typeof vi.fn>;
    let capturedOptions: Record<string, unknown>;
    let capturedCallback: (res: unknown) => void;

    beforeEach(() => {
      // Mock node:http.request
      mockRequest = vi.fn().mockImplementation((opts, cb) => {
        capturedOptions = opts;
        capturedCallback = cb;
        const req = {
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(() => {
            // Simulate response
            const res = {
              statusCode: 200,
              on: vi.fn((event: string, handler: (data?: unknown) => void) => {
                if (event === "data") {
                  handler(Buffer.from(JSON.stringify({ id: "p1", name: "Test" })));
                }
                if (event === "end") {
                  handler();
                }
              }),
            };
            capturedCallback(res);
          }),
        };
        return req;
      });

      vi.doMock("node:http", () => ({
        request: mockRequest,
      }));
    });

    afterEach(() => {
      vi.doUnmock("node:http");
    });

    it("routes requests through UDS when socketPath is set", async () => {
      const client = new AquaClient("http://localhost", null, null, {
        socketPath: "/tmp/aqua.sock",
        repoOwner: "myorg",
        repoName: "myrepo",
      });

      await client.getQAPlan("p1");

      expect(mockRequest).toHaveBeenCalled();
      expect(capturedOptions.socketPath).toBe("/tmp/aqua.sock");
      expect(capturedOptions.path).toBe("/api/qa-plans/p1");
      expect(capturedOptions.method).toBe("GET");
    });

    it("sends X-Repo-Owner and X-Repo-Name headers", async () => {
      const client = new AquaClient("http://localhost", null, null, {
        socketPath: "/tmp/aqua.sock",
        repoOwner: "myorg",
        repoName: "myrepo",
      });

      await client.getQAPlan("p1");

      const headers = capturedOptions.headers as Record<string, string>;
      expect(headers["X-Repo-Owner"]).toBe("myorg");
      expect(headers["X-Repo-Name"]).toBe("myrepo");
    });

    it("does not send Authorization header in desktop mode", async () => {
      const client = new AquaClient("http://localhost", null, null, {
        socketPath: "/tmp/aqua.sock",
      });

      await client.getQAPlan("p1");

      const headers = capturedOptions.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("does not call global fetch in desktop mode", async () => {
      const client = new AquaClient("http://localhost", null, null, {
        socketPath: "/tmp/aqua.sock",
      });

      await client.getQAPlan("p1");

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sends POST body via UDS", async () => {
      let writtenBody = "";
      mockRequest.mockImplementation((opts: Record<string, unknown>, cb: (res: unknown) => void) => {
        capturedOptions = opts;
        capturedCallback = cb;
        const req = {
          on: vi.fn(),
          write: vi.fn((data: string) => { writtenBody = data; }),
          end: vi.fn(() => {
            const res = {
              statusCode: 201,
              on: vi.fn((event: string, handler: (data?: unknown) => void) => {
                if (event === "data") {
                  handler(Buffer.from(JSON.stringify({ id: "p1" })));
                }
                if (event === "end") {
                  handler();
                }
              }),
            };
            cb(res);
          }),
        };
        return req;
      });

      const client = new AquaClient("http://localhost", null, null, {
        socketPath: "/tmp/aqua.sock",
      });

      await client.createQAPlan({ name: "New Plan" });

      expect(capturedOptions.method).toBe("POST");
      expect(JSON.parse(writtenBody)).toEqual({ name: "New Plan" });
    });

    it("handles error responses via UDS", async () => {
      mockRequest.mockImplementation((opts: Record<string, unknown>, cb: (res: unknown) => void) => {
        capturedOptions = opts;
        const req = {
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(() => {
            const res = {
              statusCode: 404,
              statusMessage: "Not Found",
              on: vi.fn((event: string, handler: (data?: unknown) => void) => {
                if (event === "data") {
                  handler(Buffer.from(JSON.stringify({ error: "Not Found" })));
                }
                if (event === "end") {
                  handler();
                }
              }),
            };
            cb(res);
          }),
        };
        return req;
      });

      const client = new AquaClient("http://localhost", null, null, {
        socketPath: "/tmp/aqua.sock",
      });

      await expect(client.getQAPlan("nonexistent")).rejects.toThrow(
        "API error 404: Not Found"
      );
    });
  });
});
