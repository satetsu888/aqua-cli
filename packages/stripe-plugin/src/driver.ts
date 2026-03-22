import Stripe from "stripe";
import { getJsonPath, extractValues } from "@aquaqa/cli/utils";
import type { Driver, Step, StepResult } from "@aquaqa/cli/plugin";
import type { StripeConfig, StripeAssertion } from "./schemas.js";
import { evaluateAssertions } from "./assertions.js";

export class StripeDriver implements Driver {
  private stripe: Stripe;

  constructor(apiKey: string) {
    this.stripe = new Stripe(apiKey);
  }

  async execute(
    step: Step,
    _variables: Record<string, string>
  ): Promise<StepResult> {
    const config = step.config as StripeConfig;
    const startedAt = new Date();

    try {
      let response: unknown;

      if (config.poll) {
        response = await this.pollStripeAPI(config);
      } else {
        response = await this.callStripeAPI(config.operation, config.params, config.limit);
      }

      const assertions = evaluateAssertions(
        step.assertions as StripeAssertion[] | undefined,
        response
      );

      const allPassed = assertions.length === 0 || assertions.every((a) => a.passed);

      return {
        stepKey: step.step_key,
        scenarioName: "",
        action: step.action,
        status: allPassed ? "passed" : "failed",
        assertionResults: assertions,
        extractedValues: extractValues(step.extract, response),
        response: {
          status: 200,
          headers: {},
          body: JSON.stringify(response, null, 2),
          duration: Date.now() - startedAt.getTime(),
        },
        startedAt,
        finishedAt: new Date(),
      };
    } catch (err) {
      const isStripeError = err instanceof Stripe.errors.StripeError;
      const errorMessage = isStripeError
        ? `Stripe API Error: ${err.message} (${err.type})`
        : err instanceof Error
          ? err.message
          : String(err);

      return {
        stepKey: step.step_key,
        scenarioName: "",
        action: step.action,
        status: "error",
        errorMessage,
        startedAt,
        finishedAt: new Date(),
      };
    }
  }

  private async pollStripeAPI(config: StripeConfig): Promise<unknown> {
    const poll = config.poll!;
    const deadline = Date.now() + poll.timeout_ms;
    let lastResponse: unknown;

    while (Date.now() < deadline) {
      lastResponse = await this.callStripeAPI(config.operation, config.params, config.limit);

      const value = getJsonPath(lastResponse, poll.until.path);
      if (String(value) === poll.until.equals) {
        return lastResponse;
      }

      await new Promise((resolve) => setTimeout(resolve, poll.interval_ms));
    }

    // Timeout: return last response (assertions will fail)
    return lastResponse ?? await this.callStripeAPI(config.operation, config.params, config.limit);
  }

  private async callStripeAPI(
    operation: string,
    params?: Record<string, string>,
    limit?: number
  ): Promise<unknown> {
    const p = params ?? {};

    switch (operation) {
      case "get_customer":
        return this.stripe.customers.retrieve(p.id);
      case "get_subscription":
        return this.stripe.subscriptions.retrieve(p.id);
      case "list_subscriptions":
        return this.stripe.subscriptions.list({
          ...(p.customer && { customer: p.customer }),
          limit,
        });
      case "get_payment_intent":
        return this.stripe.paymentIntents.retrieve(p.id);
      case "list_payment_intents":
        return this.stripe.paymentIntents.list({
          ...(p.customer && { customer: p.customer }),
          limit,
        });
      case "get_invoice":
        return this.stripe.invoices.retrieve(p.id);
      case "list_invoices":
        return this.stripe.invoices.list({
          ...(p.customer && { customer: p.customer }),
          ...(p.subscription && { subscription: p.subscription }),
          limit,
        });
      case "get_charge":
        return this.stripe.charges.retrieve(p.id);
      case "list_charges":
        return this.stripe.charges.list({
          ...(p.customer && { customer: p.customer }),
          limit,
        });
      case "get_checkout_session":
        return this.stripe.checkout.sessions.retrieve(p.id);
      case "get_product":
        return this.stripe.products.retrieve(p.id);
      case "get_price":
        return this.stripe.prices.retrieve(p.id);
      default:
        throw new Error(`Unknown Stripe operation: ${operation}`);
    }
  }
}
