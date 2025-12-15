import { Elysia } from "elysia";
import { b402Middleware } from "../../middleware/b402/middleware";
import { chatHandler } from "../chat";

/**
 * b402 Chat Route - Payment-gated chat endpoint (BNB Chain)
 *
 * Uses b402 payment protocol (USDT on BNB Chain) instead of API key authentication.
 * Reuses the same chatHandler logic as the standard /api/chat route.
 */
export const b402ChatRoute = new Elysia()
  .use(b402Middleware())
  .get("/api/b402/chat", async () => {
    return {
      message: "This endpoint requires POST method with b402 payment.",
      apiDocumentation: "https://your-docs-url.com/api",
      paymentInfo: "Include X-PAYMENT header with valid payment proof (BNB Chain)",
    };
  })
  .post("/api/b402/chat", chatHandler);
