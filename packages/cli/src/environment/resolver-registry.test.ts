import { describe, it, expect, beforeEach } from "vitest";
// Import from index to trigger built-in resolver registrations
import {
  registerResolver,
  getResolver,
  getAllResolvers,
  type ExternalSecretResolver,
} from "./index.js";

function createMockResolver(type: string): ExternalSecretResolver {
  return {
    type,
    cliName: `Mock CLI (${type})`,
    installUrl: `https://example.com/${type}`,
    async checkAvailable() {
      return true;
    },
    async resolve(entry, _context) {
      return `resolved-${entry.value}`;
    },
    validate(_entry) {
      return [];
    },
  };
}

describe("resolver-registry", () => {
  // Note: The registry is module-level state, so existing resolvers
  // (op, aws_sm, gcp_sm, hcv) are already registered via index.ts imports.

  it("returns undefined for unregistered type", () => {
    expect(getResolver("nonexistent_type")).toBeUndefined();
  });

  it("registers and retrieves a resolver", () => {
    const resolver = createMockResolver("test_resolver_1");
    registerResolver(resolver);
    expect(getResolver("test_resolver_1")).toBe(resolver);
  });

  it("overwrites existing resolver when re-registered", () => {
    const resolver1 = createMockResolver("test_resolver_2");
    const resolver2 = createMockResolver("test_resolver_2");
    registerResolver(resolver1);
    registerResolver(resolver2);
    expect(getResolver("test_resolver_2")).toBe(resolver2);
  });

  it("getAllResolvers returns all registered resolvers", () => {
    const all = getAllResolvers();
    expect(all.length).toBeGreaterThanOrEqual(4); // op, aws_sm, gcp_sm, hcv at minimum
    const types = all.map((r) => r.type);
    expect(types).toContain("op");
    expect(types).toContain("aws_sm");
    expect(types).toContain("gcp_sm");
    expect(types).toContain("hcv");
  });

  it("built-in resolvers have correct metadata", () => {
    const op = getResolver("op");
    expect(op?.cliName).toContain("1Password");
    expect(op?.installUrl).toContain("1password.com");

    const aws = getResolver("aws_sm");
    expect(aws?.cliName).toContain("AWS");

    const gcp = getResolver("gcp_sm");
    expect(gcp?.cliName).toContain("Google Cloud");

    const hcv = getResolver("hcv");
    expect(hcv?.cliName).toContain("Vault");
  });
});
