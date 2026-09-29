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

let initializationPromise = null;

function ensureX402Initialized() {
  if (!initializationPromise) {
    initializationPromise = resourceServer
      .initialize()
      .catch((error) => {
        initializationPromise = null;
        throw error;
      });
  }

  return initializationPromise;
}

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
    status: "online",
    diagnostics: [
      "/payment-requirements",
      "/facilitator-check",
      "/x402-init-check"
    ]
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

/*
 * Existing known-good diagnostic.
 *
 * Initializes x402 and asks the resource server
 * to construct the payment requirements.
 */
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
        stage: "payment-requirements",
        error: describeError(error)
      },
      500
    );
  }
});

/*
 * DIAGNOSTIC #1
 *
 * Tests the facilitator directly through the exact
 * HTTPFacilitatorClient used by x402.
 *
 * This performs NO payment and NO signing.
 */
app.get("/facilitator-check", async (c) => {
  try {
    const supported =
      await facilitatorClient.getSupported();

    const kinds = Array.isArray(supported?.kinds)
      ? supported.kinds
      : [];

    const matchingKinds = kinds.filter(
      (kind) =>
        kind?.network === PROJECT.network &&
        kind?.scheme === "exact"
    );

    return c.json({
      ok: true,
      stage: "facilitator-getSupported",
      facilitator: PROJECT.facilitatorUrl,
      totalKinds: kinds.length,
      baseSepoliaExactSupported:
        matchingKinds.length > 0,
      matchingKinds
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        stage: "facilitator-getSupported",
        facilitator: PROJECT.facilitatorUrl,
        error: describeError(error)
      },
      500
    );
  }
});

/*
 * DIAGNOSTIC #2
 *
 * Creates a completely fresh facilitator client and
 * completely fresh x402 resource server INSIDE the
 * request handler.
 *
 * This is deliberate.
 *
 * If this succeeds through the Service Binding while
 * /premium fails, we have isolated the problem to
 * lifecycle/global-state behavior rather than
 * facilitator connectivity.
 *
 * This performs NO payment and NO signing.
 */
app.get("/x402-init-check", async (c) => {
  try {
    const freshFacilitator =
      new HTTPFacilitatorClient({
        url: PROJECT.facilitatorUrl
      });

    const freshResourceServer =
      new x402ResourceServer(
        freshFacilitator
      );

    freshResourceServer.register(
      PROJECT.network,
      new ExactEvmScheme()
    );

    await freshResourceServer.initialize();

    const requirements =
      await freshResourceServer.buildPaymentRequirements({
        scheme: "exact",
        price: PROJECT.price,
        network: PROJECT.network,
        payTo: PROJECT.payTo
      });

    return c.json({
      ok: true,
      stage: "fresh-x402-initialize",
      network: PROJECT.network,
      price: PROJECT.price,
      payTo: PROJECT.payTo,
      requirements
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        stage: "fresh-x402-initialize",
        error: describeError(error)
      },
      500
    );
  }
});

/*
 * Protected x402 route.
 */
app.use("/premium", async (c, next) => {
  try {
    await ensureX402Initialized();
    await next();
  } catch (error) {
    console.error(
      "Premium initialization failure:",
      error
    );

    return c.json(
      {
        error: "x402 initialization failed",
        stage: "premium-initialize",
        detail: describeError(error)
      },
      500
    );
  }
});

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
        "/facilitator-check",
        "/x402-init-check",
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
