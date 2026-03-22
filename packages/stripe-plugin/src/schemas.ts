import { z } from "zod";

export const StripeConfigSchema = z.object({
  /** Variable name holding the Stripe API key (default: "stripe_api_key") */
  api_key_variable: z.string().default("stripe_api_key"),

  /** Stripe API operation to perform */
  operation: z.enum([
    "get_customer",
    "get_subscription",
    "list_subscriptions",
    "get_payment_intent",
    "list_payment_intents",
    "get_invoice",
    "list_invoices",
    "get_charge",
    "list_charges",
    "get_checkout_session",
    "get_product",
    "get_price",
  ]),

  /** Operation parameters (IDs, filters, etc.) */
  params: z.record(z.string()).optional(),

  /** Max items for list operations (default: 10) */
  limit: z.number().optional().default(10),

  /** Polling config for waiting on async state changes */
  poll: z.object({
    /** Polling interval in ms (default: 2000) */
    interval_ms: z.number().default(2000),
    /** Timeout in ms (default: 30000) */
    timeout_ms: z.number().default(30000),
    /** Stop condition: when response field matches expected value */
    until: z.object({
      /** Dot-path to check in response (e.g. "status", "data[0].status") */
      path: z.string(),
      /** Expected value */
      equals: z.string(),
    }),
  }).optional(),
});

export type StripeConfig = z.infer<typeof StripeConfigSchema>;

export const StripeFieldAssertionSchema = z.object({
  type: z.literal("stripe_field"),
  description: z.string().optional(),
  /** Dot-path in Stripe response (e.g. "status", "items.data[0].price.id") */
  path: z.string(),
  /** Expected value */
  expected: z.string(),
  /** Comparison condition (default: equals) */
  condition: z.enum([
    "equals", "contains", "not_equals",
    "exists", "not_exists",
    "greater_than", "less_than",
  ]).optional(),
});

export const StripeObjectExistsAssertionSchema = z.object({
  type: z.literal("stripe_object_exists"),
  description: z.string().optional(),
  /** true: object should exist, false: should not exist */
  exists: z.boolean().default(true),
});

export type StripeFieldAssertion = z.infer<typeof StripeFieldAssertionSchema>;
export type StripeObjectExistsAssertion = z.infer<typeof StripeObjectExistsAssertionSchema>;
export type StripeAssertion = StripeFieldAssertion | StripeObjectExistsAssertion;
