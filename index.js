import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import {
  x402ResourceServer,
  HTTPFacilitatorClient
} from "@x402/core/server";
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

const facilitatorClient = new HTTPFacilitatorClient({
  url: PROJECT.facilitatorUrl
});

const resourceServer = new x402ResourceServer(
  facilitatorClient
);

resourceServer.register(
  PROJECT.network,
  new ExactEvmScheme()
);

/*
 * Initialize x402 once per Worker isolate.
 * All routes that need x402 wait on the same initialization.
 */
let initializationPromise = null;

function ensureX402Initialized() {
  if (!initializationPromise) {
    initializationPromise = resourceServer.initialize().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
}

const routes = {
  "GET /premium": {
    accepts: [
      {
        scheme: "exact",
        price: PROJECT.price,
        network: PROJECT.network,
        payTo: PROJECT.payTo
      }
    ],
    description:
      "Project Vegetables paid machine-readable proof",
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
    status: "online"
  })
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "projectvegetables-x402-v2",
    basename: PROJECT.basename,
    network: PROJECT.network
  })
);

app.get("/payment-config", (c) =>
  c.json({
    ok: true,
    protectedRoute: "GET /premium",
    scheme: "exact",
    price: PROJECT.price,
    network: PROJECT.network,
    networkName: PROJECT.networkName,
    paymentAsset: "USDC",
    payTo: PROJECT.payTo,
    facilitator: PROJECT.facilitatorUrl,
    x402Version: 2
  })
);

app.get("/payment-requirements", async (c) => {
  try {
    await ensureX402Initialized();

    const requirements =
      await resourceServer.buildPaymentRequirements({
        scheme: "exact",
        price: PROJECT.price,
        network: PROJECT.network,
        payTo: PROJECT.payTo
      });

    return c.json({
      ok: true,
      configuredPrice: PROJECT.price,
      configuredNetwork: PROJECT.network,
      configuredPayTo: PROJECT.payTo,
      requirements
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error?.message ?? String(error)
      },
      500
    );
  }
});

/*
 * Ensure the shared x402 resource server is initialized
 * before the payment middleware handles /premium.
 */
app.use("/premium", async (c, next) => {
  await ensureX402Initialized();
  await next();
});

/*
 * x402 payment middleware.
 */
app.use(
  paymentMiddleware(
    routes,
    resourceServer
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
        "/payment-config",
        "/payment-requirements",
        "/premium"
      ]
    },
    404
  )
);

app.onError((error, c) => {
  console.error(
    "Project Vegetables x402 error:",
    error
  );

  return c.json(
    {
      error: "Internal Server Error",
      detail: error?.message ?? String(error)
    },
    500
  );
});

export default app;
