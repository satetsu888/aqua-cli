// Register all external secret resolvers
import { registerResolver } from "./resolver-registry.js";
import { opResolver } from "./op-resolver.js";
import { awsSmResolver } from "./aws-sm-resolver.js";
import { gcpSmResolver } from "./gcp-sm-resolver.js";
import { hcvResolver } from "./hcv-resolver.js";

registerResolver(opResolver);
registerResolver(awsSmResolver);
registerResolver(gcpSmResolver);
registerResolver(hcvResolver);

export {
  loadEnvironment,
  resolveEnvironment,
  listEnvironments,
  validateEnvironment,
  saveEnvironment,
} from "./loader.js";
export type { ValidationResult, ValidationIssue, EnvironmentSummary } from "./loader.js";
export { environmentFileSchema, secretEntrySchema, proxyConfigSchema } from "./types.js";
export type {
  EnvironmentFile,
  SecretEntry,
  ResolvedEnvironment,
  ResolvedProxyConfig,
} from "./types.js";
export type { ExternalSecretResolver } from "./resolver-registry.js";
export { registerResolver, getResolver, getAllResolvers } from "./resolver-registry.js";
export { warmSecretCache, clearSecretCache } from "./secret-cache.js";
