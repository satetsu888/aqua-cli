import { describe, it, expect, vi, beforeEach } from "vitest";
import { awsSmResolver } from "./aws-sm-resolver.js";
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

describe("awsSmResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct metadata", () => {
    expect(awsSmResolver.type).toBe("aws_sm");
    expect(awsSmResolver.cliName).toContain("AWS");
    expect(awsSmResolver.installUrl).toContain("aws.amazon.com");
  });

  describe("checkAvailable", () => {
    it("returns true when aws cli is available", async () => {
      mockExecFile("aws-cli/2.15.0");
      expect(await awsSmResolver.checkAvailable()).toBe(true);
    });

    it("returns false when aws cli is not available", async () => {
      mockExecFileError("command not found: aws");
      expect(await awsSmResolver.checkAvailable()).toBe(false);
    });
  });

  describe("resolve", () => {
    it("resolves a plain secret value", async () => {
      mockExecFile("my-secret-value\n");
      const entry: SecretEntry = { type: "aws_sm", value: "staging/api-key" };
      const result = await awsSmResolver.resolve(entry, "test");
      expect(result).toBe("my-secret-value");

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe("aws");
      expect(call[1]).toContain("--secret-id");
      expect(call[1]).toContain("staging/api-key");
    });

    it("passes region when specified", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = {
        type: "aws_sm",
        value: "my-secret",
        region: "ap-northeast-1",
      };
      await awsSmResolver.resolve(entry, "test");

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("--region");
      expect(call[1]).toContain("ap-northeast-1");
    });

    it("extracts json_key from JSON secret", async () => {
      mockExecFile('{"username":"admin","password":"secret123"}\n');
      const entry: SecretEntry = {
        type: "aws_sm",
        value: "staging/db-credentials",
        json_key: "password",
      };
      const result = await awsSmResolver.resolve(entry, "test");
      expect(result).toBe("secret123");
    });

    it("throws when json_key specified but value is not JSON", async () => {
      mockExecFile("plain-text-value\n");
      const entry: SecretEntry = {
        type: "aws_sm",
        value: "my-secret",
        json_key: "key",
      };
      await expect(awsSmResolver.resolve(entry, "test")).rejects.toThrow(
        "not valid JSON"
      );
    });

    it("throws when json_key does not exist in JSON", async () => {
      mockExecFile('{"username":"admin"}\n');
      const entry: SecretEntry = {
        type: "aws_sm",
        value: "my-secret",
        json_key: "missing_key",
      };
      await expect(awsSmResolver.resolve(entry, "test")).rejects.toThrow(
        'does not contain key "missing_key"'
      );
    });

    it("throws auth error with guidance", async () => {
      mockExecFileError("Unable to locate credentials");
      const entry: SecretEntry = { type: "aws_sm", value: "my-secret" };
      await expect(awsSmResolver.resolve(entry, "test")).rejects.toThrow(
        "aws configure"
      );
    });

    it("throws not-found error", async () => {
      mockExecFileError("ResourceNotFoundException: secret not found");
      const entry: SecretEntry = { type: "aws_sm", value: "missing-secret" };
      await expect(awsSmResolver.resolve(entry, "test")).rejects.toThrow(
        "secret not found: missing-secret"
      );
    });

    it("uses region from providerConfig when entry has no region", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = { type: "aws_sm", value: "my-secret" };
      await awsSmResolver.resolve(entry, "test", {
        region: "eu-west-1",
      });

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("--region");
      expect(call[1]).toContain("eu-west-1");
    });

    it("entry-level region overrides providerConfig region", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = {
        type: "aws_sm",
        value: "my-secret",
        region: "us-east-1",
      };
      await awsSmResolver.resolve(entry, "test", {
        region: "eu-west-1",
      });

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("us-east-1");
      expect(call[1]).not.toContain("eu-west-1");
    });

    it("passes profile from providerConfig", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = { type: "aws_sm", value: "my-secret" };
      await awsSmResolver.resolve(entry, "test", {
        profile: "staging",
      });

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("--profile");
      expect(call[1]).toContain("staging");
    });
  });

  describe("validate", () => {
    it("returns no issues", () => {
      const entry: SecretEntry = { type: "aws_sm", value: "my-secret" };
      expect(awsSmResolver.validate(entry)).toEqual([]);
    });
  });
});
