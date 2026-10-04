# Install

Server URL (replace with your own deployment if you forked it):

```
https://splitmyexpenses-mcp.lavesh.workers.dev/mcp
```

Every client uses the same flow: add the URL, then a browser window opens for the OAuth sign-in. Enter your
SplitMyExpenses email and password there (Google-only accounts must set a password in SplitMyExpenses first).
Clients register themselves automatically (DCR); no client id or secret is needed.

## Claude Desktop (and claude.ai)

1. **Settings → Connectors → Add custom connector**.
2. Name: `SplitMyExpenses`. URL: the server URL above. Leave the advanced OAuth fields empty.
3. **Add**, then **Connect** and sign in.

Claude Desktop does not take remote servers from `claude_desktop_config.json`; use the Connectors UI.

## Claude Code

```sh
claude mcp add --transport http --scope user splitmyexpenses https://splitmyexpenses-mcp.lavesh.workers.dev/mcp
```

Then run `/mcp` inside Claude Code, pick `splitmyexpenses` and choose **Authenticate**. Drop `--scope user` to
install for the current project only.

## Gemini CLI

```sh
gemini mcp add --transport http --scope user splitmyexpenses https://splitmyexpenses-mcp.lavesh.workers.dev/mcp
```

Or edit `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "splitmyexpenses": { "httpUrl": "https://splitmyexpenses-mcp.lavesh.workers.dev/mcp" }
  }
}
```

Start `gemini`, run `/mcp auth splitmyexpenses`, and sign in.

## OpenAI

**Codex CLI** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.splitmyexpenses]
url = "https://splitmyexpenses-mcp.lavesh.workers.dev/mcp"
```

then `codex mcp login splitmyexpenses`. (Older Codex versions need `experimental_use_rmcp_client = true` at the top
level of the file.)

**ChatGPT** — **Settings → Connectors → Advanced → Developer mode**, then **Create** a connector with the server
URL and **OAuth** authentication. Developer mode availability depends on your plan.

**Responses API** — the `mcp` tool cannot run the interactive sign-in. Complete OAuth yourself, then pass the access
token:

```json
{ "type": "mcp", "server_label": "splitmyexpenses",
  "server_url": "https://splitmyexpenses-mcp.lavesh.workers.dev/mcp",
  "authorization": "<access token>", "require_approval": "always" }
```

## Check it works

Ask: "List my SplitMyExpenses groups." You should see your groups with their members.

## Troubleshooting

- **Sign-in fails**: the form logs in to SplitMyExpenses for real, so the email/password must work at
  app.splitmyexpenses.com.
- **Tools missing after a redeploy**: disconnect and reconnect the connector.
- **Revoke access**: remove the connector in the client; the stored grant is then unusable.

> Client menus and flags change between releases. If a step differs, check that client's current MCP docs; the
> only server-specific inputs are the URL and the OAuth sign-in.
