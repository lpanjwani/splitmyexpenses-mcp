// Port of splitmyexpenses-wrapper's client.py (unofficial web API; session-cookie + XSRF auth).
const BASE = "https://app.splitmyexpenses.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/** Authenticated HTTP transport: owns the cookie jar, XSRF header and re-login on expiry. */
export class SmeSession {
  private jar = new Map<string, string>();
  constructor(
    private email: string,
    private password: string,
  ) {}

  private absorb(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
    }
  }

  private headers(hasJson: boolean) {
    const h: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
      cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
    };
    const xsrf = this.jar.get("XSRF-TOKEN");
    if (xsrf) h["x-xsrf-token"] = decodeURIComponent(xsrf);
    if (hasJson) h["content-type"] = "application/json";
    return h;
  }

  private async send(method: string, path: string, body?: unknown, form?: FormData): Promise<Response> {
    const res = await fetch(BASE + path, {
      method,
      headers: this.headers(body !== undefined),
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      redirect: "manual",
    });
    this.absorb(res);
    return res;
  }

  async login() {
    this.jar.clear();
    await this.send("GET", "/sanctum/csrf-cookie");
    const r = await this.send("POST", "/login", { email: this.email, password: this.password });
    if (!r.ok) throw new Error(`SplitMyExpenses login failed (${r.status})`);
  }

  async request(method: string, path: string, body?: unknown, form?: FormData): Promise<any> {
    if (!this.jar.has("XSRF-TOKEN")) await this.login();
    let r = await this.send(method, path, body, form);
    if (r.status === 401 || r.status === 419) {
      await this.login();
      r = await this.send(method, path, body, form);
    }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${(await r.text()).slice(0, 500)}`);
    return r.status === 204 ? null : r.json();
  }
}
