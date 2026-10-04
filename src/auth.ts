import { SME } from "./sme.js";
import type { Env, Props } from "./types.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The sign-in form shown during the OAuth authorize step. */
class ConsentPage {
  constructor(
    private client: string,
    private host: string,
    private action: string,
  ) {}

  render(err = "") {
    return new Response(
      `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Connect SplitMyExpenses</title><style>body{font:16px system-ui;max-width:380px;margin:12vh auto;padding:0 16px}input,button{width:100%;padding:10px;margin:6px 0;font:inherit;box-sizing:border-box}.e{color:#b00}</style>
<h2>Connect SplitMyExpenses</h2><p><b>${esc(this.client)}</b> (${esc(this.host)}) wants to read and edit your expenses. Sign in with your SplitMyExpenses account.</p>
<p class=e>${esc(err)}</p><form method=post action="${esc(this.action)}"><input name=email type=email placeholder=Email required autocomplete=username>
<input name=password type=password placeholder=Password required autocomplete=current-password><button>Authorize</button></form>
<p><small>Your credentials are stored encrypted and used only to sign in to SplitMyExpenses for you. Google-only accounts: set a password in SplitMyExpenses first.</small></p>`,
      { headers: { "content-type": "text/html;charset=utf-8", "x-frame-options": "DENY" } },
    );
  }
}

// ponytail: no per-attempt rate limit or CSRF token on the form; the OAuth request is re-validated from the query string on POST. Add Turnstile if exposed publicly.
export class AuthHandler {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/authorize") return new Response("SplitMyExpenses MCP — connect at /mcp", { status: 200 });

    const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(url, { method: "GET" }));
    const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
    const consent = new ConsentPage(
      client?.clientName ?? oauthReq.clientId,
      new URL(oauthReq.redirectUri).host,
      url.pathname + url.search,
    );

    if (request.method !== "POST") return consent.render();
    const creds = await this.readCredentials(request);
    try {
      await new SME(creds.email, creds.password).login();
    } catch {
      return consent.render("Sign-in to SplitMyExpenses failed. Check your email and password.");
    }

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReq,
      userId: encodeURIComponent(creds.email.toLowerCase()),
      metadata: { email: creds.email },
      scope: oauthReq.scope,
      props: creds satisfies Props,
    });
    return Response.redirect(redirectTo, 302);
  }

  private async readCredentials(request: Request): Promise<Props> {
    const f = await request.formData();
    return { email: String(f.get("email") ?? "").trim(), password: String(f.get("password") ?? "") };
  }
}
