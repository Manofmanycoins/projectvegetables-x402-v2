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
    return this.request("supported", { method: "GET" });
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
    status: "diagnostic"
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
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error),
        stack: error?.stack ?? null
      },
      500
    );
  }
});

/*
 * NEW: isolate resourceServer.initialize() and expose the real cause.
 */
app.get("/init-test", async (c) => {
  try {
    await resourceServer.initialize();

    const supportedKind = resourceServer.getSupportedKind(
      2,
      PROJECT.network,
      "exact"
    );

    return c.json({
      ok: true,
      initialized: true,
      supportedKindFound: Boolean(supportedKind),
      supportedKind: supportedKind ?? null
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error),
        causeName: error?.cause?.name ?? null,
        causeMessage:
          error?.cause?.message ??
          (error?.cause ? String(error.cause) : null),
        stack: error?.stack ?? null
      },
      500
    );
  }
});

/*
 * Keep facilitator auto-sync OFF while diagnosing initialization.
 */
app.use(
  paymentMiddleware(
    routes,
    resourceServer,
    undefined,
    undefined,
    false
  )
);

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
      endpoints: [
        "/",
        "/health",
        "/facilitator-health",
        "/init-test",
        "/premium"
      ]
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
