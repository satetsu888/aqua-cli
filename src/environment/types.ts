import { z } from "zod";

export const secretEntrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("literal"),
    value: z.string(),
  }),
  z.object({
    type: z.literal("env"),
    value: z.string(),
  }),
  z.object({
    type: z.literal("op"),
    value: z.string(),
  }),
  z.object({
    type: z.literal("aws_sm"),
    value: z.string(),
    region: z.string().optional(),
    json_key: z.string().optional(),
  }),
  z.object({
    type: z.literal("gcp_sm"),
    value: z.string(),
    project: z.string().optional(),
    version: z.string().optional(),
    json_key: z.string().optional(),
  }),
  z.object({
    type: z.literal("hcv"),
    value: z.string(),
    field: z.string().optional(),
    mount: z.string().optional(),
  }),
]);

export const proxyConfigSchema = z.object({
  server: z.string(),
  bypass: z.string().optional(),
  username: secretEntrySchema.optional(),
  password: secretEntrySchema.optional(),
});

export const secretProvidersSchema = z.record(z.record(z.string())).optional();

export const environmentFileSchema = z.object({
  notes: z.string().optional(),
  variables: z.record(z.string()).optional(),
  secrets: z.record(secretEntrySchema).optional(),
  secret_providers: secretProvidersSchema,
  proxy: proxyConfigSchema.optional(),
});

export type SecretEntry = z.infer<typeof secretEntrySchema>;
export type EnvironmentFile = z.infer<typeof environmentFileSchema>;

export interface ResolvedProxyConfig {
  server: string;
  bypass?: string;
  username?: string;
  password?: string;
}

export interface ResolvedEnvironment {
  /** All variables (plain + resolved secrets) for template expansion */
  variables: Record<string, string>;
  /** Keys that came from the secrets section (for masking) */
  secretKeys: Set<string>;
  /** Resolved secret values (for value-based scan masking) */
  secretValues: Set<string>;
  /** Resolved proxy configuration */
  proxy?: ResolvedProxyConfig;
}
