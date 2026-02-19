import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getCredential,
  setCredential,
  removeCredential,
  loadCredentials,
  saveCredentials,
} from "./credentials.js";
import * as fs from "node:fs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

describe("credentials", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();
  });

  describe("loadCredentials", () => {
    it("returns empty object when file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(loadCredentials()).toEqual({});
    });

    it("returns parsed credentials when file exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          "http://localhost:9080": {
            api_key: "key1",
            user_id: "u1",
          },
        })
      );
      const store = loadCredentials();
      expect(store["http://localhost:9080"]).toEqual({
        api_key: "key1",
        user_id: "u1",
      });
    });
  });

  describe("saveCredentials", () => {
    it("creates directory and writes with 0o600 permissions", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      saveCredentials({
        "http://localhost": { api_key: "k", user_id: "u" },
      });
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { mode: 0o600 }
      );
    });
  });

  describe("getCredential", () => {
    it("returns credential for matching URL", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          "http://localhost:9080": { api_key: "key1", user_id: "u1" },
        })
      );
      const cred = getCredential("http://localhost:9080");
      expect(cred).toEqual({ api_key: "key1", user_id: "u1" });
    });

    it("normalizes trailing slash", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          "http://localhost:9080": { api_key: "key1", user_id: "u1" },
        })
      );
      const cred = getCredential("http://localhost:9080/");
      expect(cred).toEqual({ api_key: "key1", user_id: "u1" });
    });

    it("returns null when not found", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
      expect(getCredential("http://unknown")).toBeNull();
    });
  });

  describe("setCredential", () => {
    it("saves credential with normalized URL", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
      setCredential("http://localhost:9080/", {
        api_key: "key1",
        user_id: "u1",
      });
      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const store = JSON.parse(written);
      expect(store["http://localhost:9080"]).toEqual({
        api_key: "key1",
        user_id: "u1",
      });
    });
  });

  describe("removeCredential", () => {
    it("removes credential for URL", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          "http://localhost:9080": { api_key: "key1", user_id: "u1" },
        })
      );
      removeCredential("http://localhost:9080");
      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const store = JSON.parse(written);
      expect(store["http://localhost:9080"]).toBeUndefined();
    });
  });
});
