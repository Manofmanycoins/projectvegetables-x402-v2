# Project Vegetables — Phase 11 x402 Reset

Fresh x402 v2 reference build for Project Vegetables.

- Network: Base Sepolia (`eip155:84532`)
- Payment: $0.01 USDC
- Protected endpoint: `/premium`
- Health endpoint: `/health`
- Facilitator: `https://x402.org/facilitator`
- Recipient: `0x5549EF31863DCD74BE3C5872eF19A3EFC27Cf169`

This build intentionally uses the current x402 v2 Hono server pattern:
`HTTPFacilitatorClient` → `x402ResourceServer` → explicit `ExactEvmScheme`
registration → `paymentMiddleware`.

The first success criterion is an unauthenticated request to `/premium`
returning HTTP 402 Payment Required instead of HTTP 500.
