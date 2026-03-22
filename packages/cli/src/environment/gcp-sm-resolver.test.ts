import { describe, it, expect, vi, beforeEach } from "vitest";
import { gcpSmResolver } from "./gcp-sm-resolver.js";
import type { SecretEntry } from "./types.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

function mockExecFile(stdout: string) {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
      cb(null, { stdout });
    },
  );
}

function mockExecFileError(message: string) {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error) => void) => {
      cb(new Error(message));
    },
  );
}

describe("gcpSmResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct metadata", () => {
    expect(gcpSmResolver.type).toBe("gcp_sm");
    expect(gcpSmResolver.cliName).toContain("Google Cloud");
    expect(gcpSmResolver.installUrl).toContain("cloud.google.com");
  });

  describe("checkAvailable", () => {
    it("returns true when gcloud is available", async () => {
      mockExecFile("Google Cloud SDK 450.0.0");
      expect(await gcpSmResolver.checkAvailable()).toBe(true);
    });

    it("returns false when gcloud is not available", async () => {
      mockExecFileError("command not found: gcloud");
      expect(await gcpSmResolver.checkAvailable()).toBe(false);
    });
  });

  describe("resolve", () => {
    it("resolves a plain secret value", async () => {
      mockExecFile("my-secret-value\n");
      const entry: SecretEntry = { type: "gcp_sm", value: "api-key" };
      const result = await gcpSmResolver.resolve(entry, "test");
      expect(result).toBe("my-secret-value");

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe("gcloud");
      expect(call[1]).toContain("--secret=api-key");
      expect(call[1]).toContain("latest"); // default version
    });

    it("passes project when specified", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = {
        type: "gcp_sm",
        value: "my-secret",
        project: "my-project-123",
      };
      await gcpSmResolver.resolve(entry, "test");

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("--project=my-project-123");
    });

    it("passes version when specified", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = {
        type: "gcp_sm",
        value: "my-secret",
        version: "3",
      };
      await gcpSmResolver.resolve(entry, "test");

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("3");
      expect(call[1]).not.toContain("latest");
    });

    it("extracts json_key from JSON secret", async () => {
      mockExecFile('{"api_key":"abc123","region":"us-west1"}\n');
      const entry: SecretEntry = {
        type: "gcp_sm",
        value: "config-secret",
        json_key: "api_key",
      };
      const result = await gcpSmResolver.resolve(entry, "test");
      expect(result).toBe("abc123");
    });

    it("throws when json_key specified but value is not JSON", async () => {
      mockExecFile("plain-text\n");
      const entry: SecretEntry = {
        type: "gcp_sm",
        value: "my-secret",
        json_key: "key",
      };
      await expect(gcpSmResolver.resolve(entry, "test")).rejects.toThrow(
        "not valid JSON"
      );
    });

    it("throws when json_key does not exist in JSON", async () => {
      mockExecFile('{"other":"value"}\n');
      const entry: SecretEntry = {
        type: "gcp_sm",
        value: "my-secret",
        json_key: "missing",
      };
      await expect(gcpSmResolver.resolve(entry, "test")).rejects.toThrow(
        'does not contain key "missing"'
      );
    });

    it("throws auth error with guidance", async () => {
      mockExecFileError("UNAUTHENTICATED: request not authenticated");
      const entry: SecretEntry = { type: "gcp_sm", value: "my-secret" };
      await expect(gcpSmResolver.resolve(entry, "test")).rejects.toThrow(
        "gcloud auth login"
      );
    });

    it("throws not-found error", async () => {
      mockExecFileError("NOT_FOUND: Secret not found");
      const entry: SecretEntry = { type: "gcp_sm", value: "missing-secret" };
      await expect(gcpSmResolver.resolve(entry, "test")).rejects.toThrow(
        "secret not found: missing-secret"
      );
    });

    it("uses project from providerConfig when entry has no project", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = { type: "gcp_sm", value: "my-secret" };
      await gcpSmResolver.resolve(entry, "test", {
        project: "default-project",
      });

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("--project=default-project");
    });

    it("entry-level project overrides providerConfig project", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = {
        type: "gcp_sm",
        value: "my-secret",
        project: "entry-project",
      };
      await gcpSmResolver.resolve(entry, "test", {
        project: "default-project",
      });

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("--project=entry-project");
      expect(call[1]).not.toContain("--project=default-project");
    });
  });

  describe("validate", () => {
    it("returns no issues", () => {
      const entry: SecretEntry = { type: "gcp_sm", value: "my-secret" };
      expect(gcpSmResolver.validate(entry)).toEqual([]);
    });
  });
});
