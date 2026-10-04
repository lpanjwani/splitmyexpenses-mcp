import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { SplitMyExpensesMCP } from "./mcp.js";
import { AuthHandler } from "./auth.js";
import type { Env } from "./types.js";

export { SplitMyExpensesMCP };

const authHandler = new AuthHandler();

// Built per request because the RFC 9728 resource URL is the deployment's own origin (workers.dev or custom domain).
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const origin = new URL(request.url).origin;
    return new OAuthProvider({
      apiHandlers: { "/mcp": SplitMyExpensesMCP.serve("/mcp") },
      defaultHandler: authHandler as any,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        resource_name: "SplitMyExpenses",
      },
    }).fetch(request, env, ctx);
  },
};
