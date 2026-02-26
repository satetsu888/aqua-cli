import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createExplorationLog,
  appendExplorationAction,
  listExplorationLogs,
  getExplorationLog,
  cleanupExplorationLogs,
  cleanupAllExplorationLogs,
  sanitizeProjectKey,
} from "./log.js";
import type { ExplorationLogAction, ExplorationLog } from "./log.js";
import * as fs from "node:fs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
}));

describe("exploration log", () => {
  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.unlinkSync).mockReset();
    vi.mocked(fs.rmSync).mockReset();
  });

  describe("sanitizeProjectKey", () => {
    it("replaces slashes with underscores", () => {
      expect(sanitizeProjectKey("github.com/owner/repo")).toBe(
        "github.com_owner_repo",
      );
    });

    it("handles keys without slashes", () => {
      expect(sanitizeProjectKey("local_project")).toBe("local_project");
    });
  });

  describe("createExplorationLog", () => {
    it("creates directory and writes log file", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      createExplorationLog("session-1", "github.com/owner/repo");

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("github.com_owner_repo"),
        { recursive: true },
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("session-1.json"),
        expect.any(String),
      );

      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const log = JSON.parse(written) as ExplorationLog;
      expect(log.session_id).toBe("session-1");
      expect(log.project_key).toBe("github.com/owner/repo");
      expect(log.actions).toEqual([]);
    });

    it("uses _no_project directory when no project key", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      createExplorationLog("session-1");

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("_no_project"),
        { recursive: true },
      );
    });

    it("skips mkdir when directory exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      createExplorationLog("session-1", "github.com/owner/repo");

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe("appendExplorationAction", () => {
    it("appends action to existing log file", () => {
      const existingLog: ExplorationLog = {
        session_id: "session-1",
        project_key: "github.com/owner/repo",
        started_at: "2026-02-25T10:00:00Z",
        updated_at: "2026-02-25T10:00:00Z",
        actions: [],
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingLog));

      const action: ExplorationLogAction = {
        type: "browser_step",
        input: { goto: "https://example.com" },
        success: true,
        url_after: "https://example.com",
        timestamp: "2026-02-25T10:00:05Z",
      };

      appendExplorationAction("session-1", action, "github.com/owner/repo");

      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const log = JSON.parse(written) as ExplorationLog;
      expect(log.actions).toHaveLength(1);
      expect(log.actions[0].type).toBe("browser_step");
      expect(log.actions[0].success).toBe(true);
      expect(log.updated_at).not.toBe("2026-02-25T10:00:00Z");
    });

    it("does nothing when log file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const action: ExplorationLogAction = {
        type: "browser_step",
        input: { goto: "https://example.com" },
        success: true,
        timestamp: "2026-02-25T10:00:05Z",
      };

      appendExplorationAction("session-1", action, "github.com/owner/repo");

      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe("listExplorationLogs", () => {
    it("returns empty array when directory does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(listExplorationLogs("github.com/owner/repo")).toEqual([]);
    });

    it("returns logs sorted by updated_at descending", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "session-old.json",
        "session-new.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const oldLog: ExplorationLog = {
        session_id: "session-old",
        project_key: "p",
        started_at: "2026-02-25T09:00:00Z",
        updated_at: "2026-02-25T09:30:00Z",
        actions: [],
      };
      const newLog: ExplorationLog = {
        session_id: "session-new",
        project_key: "p",
        started_at: "2026-02-25T10:00:00Z",
        updated_at: "2026-02-25T10:30:00Z",
        actions: [
          {
            type: "browser_step",
            input: { goto: "https://example.com" },
            success: true,
            timestamp: "2026-02-25T10:00:05Z",
          },
        ],
      };

      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify(oldLog))
        .mockReturnValueOnce(JSON.stringify(newLog));

      const logs = listExplorationLogs("p");
      expect(logs).toHaveLength(2);
      expect(logs[0].session_id).toBe("session-new");
      expect(logs[1].session_id).toBe("session-old");
    });

    it("respects limit parameter", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "s1.json",
        "s2.json",
        "s3.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const makeLogs = (id: string, hour: number) =>
        JSON.stringify({
          session_id: id,
          project_key: "p",
          started_at: `2026-02-25T${String(hour).padStart(2, "0")}:00:00Z`,
          updated_at: `2026-02-25T${String(hour).padStart(2, "0")}:00:00Z`,
          actions: [],
        });

      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(makeLogs("s1", 8))
        .mockReturnValueOnce(makeLogs("s2", 9))
        .mockReturnValueOnce(makeLogs("s3", 10));

      const logs = listExplorationLogs("p", 2);
      expect(logs).toHaveLength(2);
    });

    it("skips corrupt files", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "good.json",
        "bad.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const goodLog: ExplorationLog = {
        session_id: "good",
        project_key: "p",
        started_at: "2026-02-25T10:00:00Z",
        updated_at: "2026-02-25T10:00:00Z",
        actions: [],
      };

      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify(goodLog))
        .mockReturnValueOnce("not json");

      const logs = listExplorationLogs("p");
      expect(logs).toHaveLength(1);
      expect(logs[0].session_id).toBe("good");
    });
  });

  describe("getExplorationLog", () => {
    it("returns log when file exists", () => {
      const log: ExplorationLog = {
        session_id: "session-1",
        project_key: "github.com/owner/repo",
        started_at: "2026-02-25T10:00:00Z",
        updated_at: "2026-02-25T10:05:00Z",
        actions: [
          {
            type: "browser_step",
            input: { goto: "https://example.com" },
            success: true,
            url_after: "https://example.com",
            timestamp: "2026-02-25T10:00:05Z",
          },
        ],
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(log));

      const result = getExplorationLog("session-1", "github.com/owner/repo");
      expect(result).not.toBeNull();
      expect(result!.session_id).toBe("session-1");
      expect(result!.actions).toHaveLength(1);
    });

    it("returns null when file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(
        getExplorationLog("session-1", "github.com/owner/repo"),
      ).toBeNull();
    });

    it("returns null for corrupt file", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("not json");

      expect(
        getExplorationLog("session-1", "github.com/owner/repo"),
      ).toBeNull();
    });
  });

  describe("cleanupExplorationLogs", () => {
    it("does nothing when directory does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      cleanupExplorationLogs("github.com/owner/repo");
      expect(fs.readdirSync).not.toHaveBeenCalled();
    });

    it("removes files older than 1 day", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "old.json",
        "new.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const now = Date.now();
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
      const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();

      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(
          JSON.stringify({
            session_id: "old",
            project_key: "p",
            started_at: twoDaysAgo,
            updated_at: twoDaysAgo,
            actions: [],
          }),
        )
        .mockReturnValueOnce(
          JSON.stringify({
            session_id: "new",
            project_key: "p",
            started_at: fiveMinAgo,
            updated_at: fiveMinAgo,
            actions: [],
          }),
        );

      // After cleanup, readdirSync is called again to check if directory is empty
      vi.mocked(fs.readdirSync).mockReturnValueOnce([
        "old.json",
        "new.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.readdirSync).mockReturnValueOnce([
        "new.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      cleanupExplorationLogs("p");

      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining("old.json"),
      );
    });

    it("removes files exceeding max count", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Create 32 files (2 over limit of 30)
      const files = Array.from({ length: 32 }, (_, i) => `s${i}.json`);
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce(
          files as unknown as ReturnType<typeof fs.readdirSync>,
        )
        .mockReturnValueOnce(
          files.slice(0, 30) as unknown as ReturnType<typeof fs.readdirSync>,
        );

      const now = Date.now();
      for (let i = 0; i < 32; i++) {
        // All recent (within 1 day), but sorted by time
        const time = new Date(now - i * 60 * 1000).toISOString();
        vi.mocked(fs.readFileSync).mockReturnValueOnce(
          JSON.stringify({
            session_id: `s${i}`,
            project_key: "p",
            started_at: time,
            updated_at: time,
            actions: [],
          }),
        );
      }

      cleanupExplorationLogs("p");

      // Should remove the 2 oldest files (index 30 and 31 after sorting)
      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    });

    it("removes corrupt files", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          "corrupt.json",
        ] as unknown as ReturnType<typeof fs.readdirSync>)
        .mockReturnValueOnce(
          [] as unknown as ReturnType<typeof fs.readdirSync>,
        );

      vi.mocked(fs.readFileSync).mockReturnValue("not json");

      cleanupExplorationLogs("p");

      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining("corrupt.json"),
      );
    });

    it("removes empty directory after cleanup", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          "old.json",
        ] as unknown as ReturnType<typeof fs.readdirSync>)
        .mockReturnValueOnce(
          [] as unknown as ReturnType<typeof fs.readdirSync>,
        );

      const twoDaysAgo = new Date(
        Date.now() - 2 * 24 * 60 * 60 * 1000,
      ).toISOString();
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          session_id: "old",
          project_key: "p",
          started_at: twoDaysAgo,
          updated_at: twoDaysAgo,
          actions: [],
        }),
      );

      cleanupExplorationLogs("p");

      expect(fs.rmSync).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
    });
  });

  describe("cleanupAllExplorationLogs", () => {
    it("does nothing when explorations directory does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      cleanupAllExplorationLogs();
      expect(fs.readdirSync).not.toHaveBeenCalled();
    });

    it("cleans up all project directories", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Top-level: list project directories
      vi.mocked(fs.readdirSync).mockReturnValueOnce([
        "github.com_owner_repo1",
        "github.com_owner_repo2",
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      // For each project dir: list files, then check if empty after cleanup
      const twoDaysAgo = new Date(
        Date.now() - 2 * 24 * 60 * 60 * 1000,
      ).toISOString();

      // repo1: 1 old file
      vi.mocked(fs.readdirSync).mockReturnValueOnce([
        "old.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.readFileSync).mockReturnValueOnce(
        JSON.stringify({
          session_id: "old",
          project_key: "p",
          started_at: twoDaysAgo,
          updated_at: twoDaysAgo,
          actions: [],
        }),
      );
      vi.mocked(fs.readdirSync).mockReturnValueOnce(
        [] as unknown as ReturnType<typeof fs.readdirSync>,
      );

      // repo2: 1 recent file
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      vi.mocked(fs.readdirSync).mockReturnValueOnce([
        "new.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.readFileSync).mockReturnValueOnce(
        JSON.stringify({
          session_id: "new",
          project_key: "p",
          started_at: fiveMinAgo,
          updated_at: fiveMinAgo,
          actions: [],
        }),
      );
      vi.mocked(fs.readdirSync).mockReturnValueOnce([
        "new.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      cleanupAllExplorationLogs();

      // Old file should be removed, new file kept
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining("old.json"),
      );
      // Empty directory should be removed
      expect(fs.rmSync).toHaveBeenCalledTimes(1);
    });
  });
});
