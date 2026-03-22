import { describe, it, expect, vi, beforeEach } from "vitest";
import { StripeDriver } from "./driver.js";

// Mock Stripe SDK
const mockStripe = {
  customers: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn(), list: vi.fn() },
  paymentIntents: { retrieve: vi.fn(), list: vi.fn() },
  invoices: { retrieve: vi.fn(), list: vi.fn() },
  charges: { retrieve: vi.fn(), list: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn() } },
  products: { retrieve: vi.fn() },
  prices: { retrieve: vi.fn() },
};

vi.mock("stripe", () => {
  class StripeError extends Error {
    type: string;
    constructor(message: string, type: string) {
      super(message);
      this.type = type;
    }
  }

  function StripeMock() {
    return mockStripe;
  }
  StripeMock.errors = { StripeError };

  return { default: StripeMock };
});

function makeStep(overrides?: Record<string, unknown>) {
  return {
    id: "stp1",
    step_key: "check_sub",
    action: "stripe",
    config: {
      operation: "get_subscription",
      params: { id: "sub_123" },
    },
    sort_order: 0,
    ...overrides,
  };
}

describe("StripeDriver", () => {
  beforeEach(() => {
    vi.mocked(mockStripe.subscriptions.retrieve).mockReset();
    vi.mocked(mockStripe.subscriptions.list).mockReset();
    vi.mocked(mockStripe.customers.retrieve).mockReset();
    vi.mocked(mockStripe.paymentIntents.retrieve).mockReset();
    vi.mocked(mockStripe.paymentIntents.list).mockReset();
  });

  it("executes get_subscription and returns passed", async () => {
    const mockResponse = { id: "sub_123", status: "active" };
    vi.mocked(mockStripe.subscriptions.retrieve).mockResolvedValue(mockResponse);

    const driver = new StripeDriver("sk_test_123");
    const result = await driver.execute(makeStep() as never, {});

    expect(result.status).toBe("passed");
    expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123");
    expect(result.response?.body).toContain("active");
  });

  it("evaluates stripe_field assertions", async () => {
    vi.mocked(mockStripe.subscriptions.retrieve).mockResolvedValue({
      id: "sub_123",
      status: "active",
    });

    const step = makeStep({
      assertions: [
        { type: "stripe_field", path: "status", expected: "active" },
      ],
    });

    const driver = new StripeDriver("sk_test_123");
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(result.assertionResults).toHaveLength(1);
    expect(result.assertionResults![0].passed).toBe(true);
  });

  it("returns failed when assertion does not match", async () => {
    vi.mocked(mockStripe.subscriptions.retrieve).mockResolvedValue({
      id: "sub_123",
      status: "canceled",
    });

    const step = makeStep({
      assertions: [
        { type: "stripe_field", path: "status", expected: "active" },
      ],
    });

    const driver = new StripeDriver("sk_test_123");
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("failed");
    expect(result.assertionResults![0].passed).toBe(false);
    expect(result.assertionResults![0].actual).toBe("canceled");
  });

  it("extracts values from response", async () => {
    vi.mocked(mockStripe.subscriptions.retrieve).mockResolvedValue({
      id: "sub_123",
      status: "active",
      items: { data: [{ price: { id: "price_abc" } }] },
    });

    const step = makeStep({
      extract: {
        sub_status: "$.status",
        price_id: "$.items.data[0].price.id",
      },
    });

    const driver = new StripeDriver("sk_test_123");
    const result = await driver.execute(step as never, {});

    expect(result.extractedValues).toEqual({
      sub_status: "active",
      price_id: "price_abc",
    });
  });

  it("handles list_subscriptions with customer param", async () => {
    vi.mocked(mockStripe.subscriptions.list).mockResolvedValue({
      data: [{ id: "sub_1", status: "active" }],
    });

    const step = makeStep({
      config: {
        operation: "list_subscriptions",
        params: { customer: "cus_123" },
        limit: 5,
      },
    });

    const driver = new StripeDriver("sk_test_123");
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(mockStripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_123",
      limit: 5,
    });
  });

  it("returns error for unknown operation", async () => {
    const step = makeStep({
      config: { operation: "unknown_op", params: {} },
    });

    const driver = new StripeDriver("sk_test_123");
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("Unknown Stripe operation");
  });

  it("returns error when Stripe API fails", async () => {
    vi.mocked(mockStripe.subscriptions.retrieve).mockRejectedValue(
      new Error("No such subscription: sub_invalid")
    );

    const driver = new StripeDriver("sk_test_123");
    const result = await driver.execute(makeStep() as never, {});

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("No such subscription");
  });

  it("executes get_customer operation", async () => {
    vi.mocked(mockStripe.customers.retrieve).mockResolvedValue({
      id: "cus_123",
      email: "test@example.com",
    });

    const step = makeStep({
      config: { operation: "get_customer", params: { id: "cus_123" } },
    });

    const driver = new StripeDriver("sk_test_123");
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(mockStripe.customers.retrieve).toHaveBeenCalledWith("cus_123");
  });

  it("executes get_payment_intent operation", async () => {
    vi.mocked(mockStripe.paymentIntents.retrieve).mockResolvedValue({
      id: "pi_123",
      status: "succeeded",
      amount: 1000,
    });

    const step = makeStep({
      config: { operation: "get_payment_intent", params: { id: "pi_123" } },
    });

    const driver = new StripeDriver("sk_test_123");
    const result = await driver.execute(step as never, {});

    expect(result.status).toBe("passed");
    expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_123");
  });
});
