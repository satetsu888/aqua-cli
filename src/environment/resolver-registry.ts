import type { SecretEntry } from "./types.js";
import type { ValidationIssue } from "./loader.js";

/** Provider-level configuration passed from the environment file's secret_providers section */
export type ProviderConfig = Record<string, string>;

/**
 * External CLI-based secret resolver interface.
 * Each resolver handles a specific SecretEntry type (e.g., "op", "aws_sm").
 */
export interface ExternalSecretResolver {
  /** SecretEntry.type identifier */
  readonly type: string;
  /** Human-readable CLI name for error messages */
  readonly cliName: string;
  /** Installation instructions URL */
  readonly installUrl: string;
  /** Check if the CLI tool is available on PATH */
  checkAvailable(): Promise<boolean>;
  /** Resolve a SecretEntry to its plain string value */
  resolve(entry: SecretEntry, context: string, providerConfig?: ProviderConfig): Promise<string>;
  /** Validate an entry without resolving (for validateEnvironment) */
  validate(entry: SecretEntry, providerConfig?: ProviderConfig): ValidationIssue[];
}

const resolvers = new Map<string, ExternalSecretResolver>();

export function registerResolver(resolver: ExternalSecretResolver): void {
  resolvers.set(resolver.type, resolver);
}

export function getResolver(type: string): ExternalSecretResolver | undefined {
  return resolvers.get(type);
}

export function getAllResolvers(): ExternalSecretResolver[] {
  return [...resolvers.values()];
}
