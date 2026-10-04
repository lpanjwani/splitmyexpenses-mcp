# splitmyexpenses-mcp

A remote [MCP](https://modelcontextprotocol.io) server that lets Claude (or any MCP client) read and edit your
[SplitMyExpenses](https://app.splitmyexpenses.com) account. Runs on Cloudflare Workers; multi-user via OAuth 2.1.

> Unofficial: it drives SplitMyExpenses' web API (session cookie + XSRF), which may change without notice.

## Tools

| Tool | What it does |
|---|---|
| `list_groups` | Your expense groups, with members (`keyedUsers` = id → name). |
| `list_friends` | Friends with balances. |
| `list_categories` | Category name → id map (ids 1–134) for create/update. |
| `list_expenses` | Every expense in a group or a friend's non-group balance (all pages). |
| `create_expense` | Create an equal-split expense, or a solo one-person expense. |
| `update_expense` | Edit fields; amount/participants/payer changes recompute an equal split. |
| `delete_expense` | Permanently delete (requires `confirm: true`). |
| `add_attachment` | Attach a base64 receipt (JPEG/PNG/PDF). |
| `delete_attachment` | Permanently delete an attachment (requires `confirm: true`; id from `list_expenses`). |

Conventions:
- **Amounts are minor units**: AED 119.20 = `11920`.
- **Scope**: tools that take it need exactly one of `group_id` (a group) or `friend_id` (a non-group expense).
- **User ids** come from `list_groups` / `list_friends`; never guess them.
- **Dates** are `YYYY-MM-DD`; currency defaults to `AED`.

### Solo (one-person) expenses

Omit `participants` on `create_expense` and only the payer is in the split:

```json
{ "group_id": 21896, "description": "Taxi", "amount": 4500, "date": "2026-10-04", "paid_by": 6913 }
```

Passing `participants: [6913]` is equivalent. `update_expense` can also shrink a split to one person the same way.

## How it works

```
MCP client ──OAuth──▶ Worker ──▶ AuthHandler (/authorize sign-in form, validates SME login)
           ──/mcp───▶ Worker ──▶ SplitMyExpensesMCP (Durable Object per session)
                                    └─ SME (domain API) ─ SmeSession (cookies, XSRF, re-login) ─▶ app.splitmyexpenses.com
```

| File | Role |
|---|---|
| `src/index.ts` | Entry: wires `OAuthProvider` (`/mcp`, `/authorize`, `/token`, `/register`). |
| `src/auth.ts` | `AuthHandler` + `ConsentPage`: sign-in form; verifies credentials by logging in. |
| `src/mcp.ts` | `SplitMyExpensesMCP`: registers the tools. |
| `src/sme.ts` | `SME`: groups, friends, expenses, equal-split maths, attachments. |
| `src/session.ts` | `SmeSession`: cookie jar, XSRF header, one retry on 401/419. |
| `src/types.ts`, `src/categories.ts` | Shared types; category id map. |

Credentials: SplitMyExpenses has no token API, so your email and password are stored in the OAuth grant `props`,
encrypted at rest by `workers-oauth-provider`, and used only to sign in for you. Google-only accounts must set a
password in SplitMyExpenses first.

## Deploy

```sh
npm i
npx wrangler kv namespace create OAUTH_KV   # paste the id into wrangler.jsonc
npx wrangler deploy                          # set CLOUDFLARE_ACCOUNT_ID if you have several accounts
```

Then add `https://<worker>.workers.dev/mcp` as a connector. Choose **Register automatically** (DCR); CIMD is not enabled.

Develop: `npm run dev` (local), `npm run check` (typecheck), `npx prettier --write src` (format, 120 cols).

## Limits

- Equal splits only for create/update (unequal `splitType 2` needs the Python wrapper).
- The sign-in form has no rate limit or CSRF token; add Turnstile if you expose it widely.
- Solo expenses assume the API accepts a single-share split, which works for group expenses; untested for friend scope.
- `delete_attachment` uses the conventional `DELETE /expenses/{id}/attachments/{attachment_id}` route, unverified live.
- `get_expense` scans all pages, so very large groups are slower to edit.
