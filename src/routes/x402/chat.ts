import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402";
import { chatHandler } from "../chat";

/**
 * x402 Chat Route - Payment-gated chat endpoint
 *
 * Uses x402 payment protocol instead of API key authentication.
 * Reuses the same chatHandler logic as the standard /api/chat route.
 */
export const x402ChatRoute = new Elysia()
  .use(x402Middleware())
  .get("/api/x402/chat", async () => {
    return {
      message: "This endpoint requires POST method with x402 payment.",
      apiDocumentation: "https://your-docs-url.com/api",
      paymentInfo: "Include X-PAYMENT header with valid payment proof",
    };
  })
  .post("/api/x402/chat", chatHandler);
