import { Elysia, t } from "elysia";
import { cookie } from "@elysiajs/cookie";

const AUTH_COOKIE = "bioagents_dev_auth";
const UI_PASSWORD = process.env.UI_PASSWORD || "";

export const authRoute = new Elysia({ prefix: "/api/auth" })
  .use(cookie())
  // Login endpoint
  .post(
    "/login",
    async ({ body, cookie, set }) => {
      // If no password is required, always succeed
      if (!UI_PASSWORD) {
        return { success: true, message: "Authentication not required" };
      }

      // Validate password
      if (body.password === UI_PASSWORD) {
        // Set HttpOnly cookie
        const authCookie = cookie[AUTH_COOKIE];
        if (authCookie) {
          authCookie.set({
            value: "authenticated",
            httpOnly: true,
            sameSite: "strict",
            path: "/",
            maxAge: 24 * 60 * 60, // 24 hours in seconds
            secure: process.env.NODE_ENV === "production",
          });
        }

        return { success: true };
      }

      // Invalid password
      set.status = 401;
      return { success: false, message: "Invalid password" };
    },
    {
      body: t.Object({
        password: t.String(),
      }),
    }
  )

  // Logout endpoint
  .post("/logout", ({ cookie }) => {
    // Delete cookie by setting maxAge to 0
    const authCookie = cookie[AUTH_COOKIE];
    if (authCookie) {
      authCookie.set({
        value: "",
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      });
    }

    return { success: true };
  })

  // Check auth status
  .get("/status", ({ cookie }) => {
    const isAuthRequired = UI_PASSWORD.length > 0;
    const isAuthenticated = isAuthRequired
      ? cookie[AUTH_COOKIE]?.value === "authenticated"
      : true;

    return {
      isAuthRequired,
      isAuthenticated,
    };
  });
