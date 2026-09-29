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

function describeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error?.name ?? null,
    message: error?.message ?? String(error),
    cause: error?.cause
      ? {
          name: error.cause?.name ?? null,
          message:
            error.cause?.message ??
            String(error.cause)
        }
      : null
  };
}

/*
 * IMPORTANT:
 *
 * Create the x402 facilitator and resource server
 * INSIDE the active request.
 *
 * We experimentally verified this works through:
 *
 * Sessionkey
 *   -> Cloudflare Service Binding
 *   -> Vegetables
 *   -> x402 facilitator
 *   -> Base Sepolia exact
 *
 * Nothing containing request-bound async state is
 * retained globally between Worker requests.
 */
function createX402Server() {
  const facilitatorClient =
    new HTTPFacilitatorClient({
      url: PROJECT.facilitatorUrl
    });

  const resourceServer =
    new x402ResourceServer(
      facilitatorClient
    );

  resourceServer.register(
    PROJECT.network,
    new ExactEvmScheme()
  );

  return {
    facilitatorClient,
    resourceServer
  };
}

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
    x402Version: 2,
    lifecycle: "request-scoped",
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
    x402Version: 2,
    lifecycle: "request-scoped"
  })
);

/*
 * Safe diagnostic.
 *
 * Creates exactly the same type of fresh x402 server
 * that /premium now uses.
 *
 * No signing.
 * No payment.
 */
app.get("/payment-requirements", async (c) => {
  try {
    const { resourceServer } =
      createX402Server();

    await resourceServer.initialize();

    const requirements =
      await resourceServer.buildPaymentRequirements({
        scheme: "exact",
        price: PROJECT.price,
        network: PROJECT.network,
        payTo: PROJECT.payTo
      });

    return c.json({
      ok: true,
      lifecycle: "request-scoped",
      configuredPrice: PROJECT.price,
      configuredNetwork: PROJECT.network,
      configuredPayTo: PROJECT.payTo,
      requirements
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        stage: "payment-requirements",
        error: describeError(error)
      },
      500
    );
  }
});

/*
 * THE PROTECTED ROUTE.
 *
 * Everything x402-related is constructed and
 * initialized while this request context is active.
 */
app.use("/premium", async (c, next) => {
  try {
    const { resourceServer } =
      createX402Server();

    await resourceServer.initialize();

    const middleware = paymentMiddleware(
      routes,
      resourceServer
    );

    return await middleware(c, next);
  } catch (error) {
    console.error(
      "Project Vegetables premium x402 failure:",
      error
    );

    return c.json(
      {
        error: "x402 premium request failed",
        stage: "request-scoped-premium",
        detail: describeError(error)
      },
      500
    );
  }
});

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
      detail: describeError(error)
    },
    500
  );
});

export default app;
