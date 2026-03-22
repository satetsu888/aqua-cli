# @aquaqa/stripe-plugin

Stripe plugin for [aqua](https://aquaqa.com/) — verify Stripe resource states in your QA plans.

This plugin adds a `stripe` action type to aqua, allowing you to check the state of Stripe resources (customers, subscriptions, payment intents, etc.) as part of your QA test plans.

[日本語 README](./README.ja.md)

## Installation

```bash
npm install @aquaqa/stripe-plugin
```

## Setup

### 1. Add to project config

Add the plugin to your `.aqua/config.json`:

```jsonc
{
  "server_url": "https://app.aquaqa.com",
  "project_key": "github.com/owner/repo",
  "plugins": ["@aquaqa/stripe-plugin"]
}
```

### 2. Configure Stripe API key

Add your Stripe API key to an environment file (`.aqua/environments/<name>.json`):

```jsonc
{
  "secrets": {
    "stripe_api_key": { "type": "env", "name": "STRIPE_SECRET_KEY" }
  }
}
```

The key is automatically masked before being sent to the aqua server.

## Usage

Use the `stripe` action type in your QA plan steps:

```jsonc
{
  "step_key": "check_subscription",
  "action": "stripe",
  "config": {
    "operation": "get_subscription",
    "params": { "id": "{{subscription_id}}" }
  },
  "assertions": [
    {
      "type": "stripe_field",
      "path": "status",
      "expected": "active",
      "description": "Subscription should be active"
    }
  ],
  "extract": {
    "plan_id": "$.items.data[0].price.id"
  }
}
```

### Polling

For async operations (e.g., waiting for a webhook to process), use the `poll` config:

```jsonc
{
  "config": {
    "operation": "get_subscription",
    "params": { "id": "{{subscription_id}}" },
    "poll": {
      "interval_ms": 2000,
      "timeout_ms": 30000,
      "until": { "path": "status", "equals": "active" }
    }
  }
}
```

## Supported Operations

| Operation | Required Params | Description |
|---|---|---|
| `get_customer` | `id` | Retrieve a customer |
| `get_subscription` | `id` | Retrieve a subscription |
| `list_subscriptions` | `customer` (optional) | List subscriptions |
| `get_payment_intent` | `id` | Retrieve a PaymentIntent |
| `list_payment_intents` | `customer` (optional) | List PaymentIntents |
| `get_invoice` | `id` | Retrieve an invoice |
| `list_invoices` | `customer`/`subscription` (optional) | List invoices |
| `get_charge` | `id` | Retrieve a charge |
| `list_charges` | `customer` (optional) | List charges |
| `get_checkout_session` | `id` | Retrieve a Checkout Session |
| `get_product` | `id` | Retrieve a product |
| `get_price` | `id` | Retrieve a price |

## Assertion Types

### `stripe_field`

Check a field value in the Stripe response:

```jsonc
{
  "type": "stripe_field",
  "path": "status",                  // dot-path (e.g. "items.data[0].price.id")
  "expected": "active",
  "condition": "equals"              // equals | contains | not_equals | exists | not_exists | greater_than | less_than
}
```

### `stripe_object_exists`

Check whether the Stripe object exists:

```jsonc
{
  "type": "stripe_object_exists",
  "exists": true
}
```

## License

MIT
