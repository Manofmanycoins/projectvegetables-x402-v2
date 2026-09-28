import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const app = new Hono();

const PROJECT = {
  name: "Project Vegetables",
  basename: "vegetables.base.eth",
  agentId: 95581,
  payTo: "0x5549EF31863DCD74BE3C5872eF19A3EFC27Cf169",
  network: "eip155:84532",
  networkName: "Base Sepolia",
  price: "$0.01",
  facilitatorUrl: "https://x402.org/facilitator"
};

/*
 * Cloudflare-native facilitator client.
 *
 * It implements the three methods x402ResourceServer expects:
 *   getSupported()
 *   verify()
 *   settle()
 *
 * We intentionally use plain Worker fetch() calls and avoid the stock
 * HTTPFacilitatorClient request/timeout layer that has been failing in
 * this Cloudflare runtime.
 */
class CloudflareFacilitatorClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}/${path}`, {
      redirect: "follow",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const text = await response.text();

    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `Facilitator ${path} returned non-JSON (${response.status}): ${text.slice(0, 300)}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Facilitator ${path} failed (${response.status}): ${JSON.stringify(body).slice(0, 500)}`
      );
    }

    return body;
  }

  async getSupported() {
    return this.request("supported", {
      method: "GET"
    });
  }

  async verify(paymentPayload, paymentRequirements) {
    return this.request("verify", {
      method: "POST",
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version,
        paymentPayload,
        paymentRequirements
      })
    });
  }

  async settle(paymentPayload, paymentRequirements) {
    return this.request("settle", {
      method: "POST",
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version,
        paymentPayload,
        paymentRequirements
      })
    });
  }
}

const facilitatorClient = new CloudflareFacilitatorClient(
  PROJECT.facilitatorUrl
);

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(PROJECT.network, new ExactEvmScheme());

const routes = {
  "GET /premium": {
    accepts: {
      scheme: "exact",
      price: PROJECT.price,
      network: PROJECT.network,
      payTo: PROJECT.payTo
    },
    description: "Project Vegetables paid machine-readable proof",
    mimeType: "application/json"
  }
};

/*
 * Public endpoints are registered before the payment middleware.
 */

app.get("/", (c) =>
  c.json({
    service: "Project Vegetables x402",
    basename: PROJECT.basename,
    erc8004Agent: PROJECT.agentId,
    environment: "testnet",
    network: PROJECT.network,
    networkName: PROJECT.networkName,
    paymentAsset: "USDC",
    price: PROJECT.price,
    paidEndpoint: "/premium",
    recipient: PROJECT.payTo,
    facilitator: PROJECT.facilitatorUrl,
    status: "ready"
  })
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "projectvegetables-x402-v2",
    basename: PROJECT.basename,
    network: PROJECT.network,
    exactSchemeRegistered: resourceServer.hasRegisteredScheme(
      PROJECT.network,
      "exact"
    )
  })
);

/*
 * Directly test the facilitator with Cloudflare's native fetch.
 * This endpoint makes no payment and exposes no secrets.
 */
app.get("/facilitator-health", async (c) => {
  try {
    const supported = await facilitatorClient.getSupported();

    const exactBaseSepolia = Array.isArray(supported?.kinds)
      ? supported.kinds.some(
          (kind) =>
            kind?.x402Version === 2 &&
            kind?.scheme === "exact" &&
            kind?.network === PROJECT.network
        )
      : false;

    return c.json({
      ok: true,
      facilitator: PROJECT.facilitatorUrl,
      kindsLoaded: Array.isArray(supported?.kinds)
        ? supported.kinds.length
        : 0,
      exactBaseSepolia
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        facilitator: PROJECT.facilitatorUrl,
        error: error?.message ?? String(error)
      },
      500
    );
  }
});

/*
 * Let the x402 server initialize normally now that the facilitator
 * client uses plain Cloudflare-native fetch().
 */
app.use(paymentMiddleware(routes, resourceServer));

app.get("/premium", (c) =>
  c.json({
    paid: true,
    provider: PROJECT.name,
    basename: PROJECT.basename,
    erc8004Agent: PROJECT.agentId,
    network: PROJECT.network,
    message:
      "Payment verified. Project Vegetables released this x402-protected resource.",
    timestamp: new Date().toISOString()
  })
);

app.notFound((c) =>
  c.json(
    {
      error: "Not found",
      endpoints: ["/", "/health", "/facilitator-health", "/premium"]
    },
    404
  )
);

app.onError((error, c) => {
  console.error("Project Vegetables x402 error:", error);

  return c.json(
    {
      error: "Internal Server Error",
      detail: error?.message ?? String(error)
    },
    500
  );
});

export default app;
