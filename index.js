import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

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

// Follow the current x402 v2 Hono server pattern exactly:
// remote HTTP facilitator + explicit EVM exact scheme registration.
const facilitatorClient = new HTTPFacilitatorClient({
  url: PROJECT.facilitatorUrl
});

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

// Apply x402 only to the configured protected route.
// The fifth argument is left at its documented default (true) so the
// resource server syncs supported payment kinds from the public test facilitator.
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
      endpoints: ["/", "/health", "/premium"]
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
