# Payflow Embeddable Subscribe Button

Merchants can place Payflow subscription buttons and plan cards directly onto their own websites, web applications, or landing pages.

## Features & Guarantees
- **Works on Plain HTML:** No build tools, React, or frameworks required.
- **Zero Third-Party Tracking:** 100% self-contained script with no external trackers, cookies, or remote analytics.
- **Seamless Popup Flow:** Opens the Payflow subscribe modal in a centered popup window allowing subscribers to connect Stellar wallets and approve recurring mandates.
- **Contract-Only & Backend Compatibility:** Resolves plans and executes mandate creation directly on Soroban contracts or via the Payflow backend.

---

## Quickstart

### 1. Include the Script
Add the embed script to your document head:

```html
&lt;script src="https://mmm-pay.github.io/payflow-frontend/embed/payflow-embed.js" defer&gt;&lt;/script&gt;
```

### 2. Add the `<payflow-button>` Element
Place the custom element where you want the subscription card or button to appear:

```html
<payflow-button
  plan-id="1"
  merchant="GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H"
  name="Pro Plan"
  amount="10 XLM"
  period="monthly">
</payflow-button>
```

---

## Attributes & Data Reference

| Attribute | HTML Data Attribute | Required | Description | Example |
|---|---|---|---|---|
| `plan-id` | `data-payflow-plan-id` | **Yes** | Numeric Soroban Plan ID on the deployed registry | `"1"` |
| `merchant` | `data-merchant` | No | Stellar G-address of the merchant | `"GAKO..."` |
| `name` | `data-name` | No | Plan title displayed in the card header | `"Premium Membership"` |
| `amount` | `data-amount` | No | Price with token symbol | `"25 XLM"` |
| `period` | `data-period` | No | Billing period label | `"monthly"`, `"30 days"` |
| `theme` | `data-theme` | No | Color theme: `"dark"` (default) or `"light"` | `"dark"` |
| `app-url` | `data-app-url` | No | Custom Payflow frontend URL (defaults to hosted site) | `"http://localhost:3000"` |

---

## Alternative: HTML Data Attributes
If you prefer standard HTML tags over custom elements:

```html
<div
  data-payflow-plan-id="1"
  data-merchant="GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H"
  data-name="Pro Plan"
  data-amount="10 XLM"
  data-period="monthly">
</div>
```

---

## Testing Locally
Open `embed/test.html` directly in any web browser or via a local static HTTP server.
