import type { AquaPlugin } from "@aquaqa/cli/plugin";
import { StripeDriver } from "./driver.js";
import {
  StripeConfigSchema,
  StripeFieldAssertionSchema,
  StripeObjectExistsAssertionSchema,
} from "./schemas.js";

const stripePlugin: AquaPlugin = {
  name: "@aquaqa/stripe-plugin",
  actionType: "stripe",
  configSchema: StripeConfigSchema,
  assertionSchemas: [StripeFieldAssertionSchema, StripeObjectExistsAssertionSchema],

  actionDescription: [
    "Stripe API でリソース状態を確認。環境変数に stripe_api_key を設定してください。",
    "operations: get_customer, get_subscription, list_subscriptions, get_payment_intent, list_payment_intents, get_invoice, list_invoices, get_charge, list_charges, get_checkout_session, get_product, get_price",
    "assertions: stripe_field (path + expected で値チェック), stripe_object_exists",
    "poll: { interval_ms, timeout_ms, until: { path, equals } } で非同期処理の完了待ちが可能",
  ].join("\n    "),

  async createDriver(variables: Record<string, string>) {
    const apiKeyVariable = "stripe_api_key";
    const apiKey = variables[apiKeyVariable];
    if (!apiKey) {
      throw new Error(
        `"${apiKeyVariable}" variable is required. Set it in your environment file:\n` +
        `  "secrets": { "${apiKeyVariable}": { "type": "env", "name": "STRIPE_SECRET_KEY" } }`
      );
    }
    return new StripeDriver(apiKey);
  },
};

export default stripePlugin;
