# IR35Careers MCP server

This local, read-only MCP server exposes four tools:

- `search_contracts`
- `get_contract`
- `analyse_public_job_url`
- `explain_ir35_evidence`

It can read public contract data. It cannot sign in, access a CV, save a role,
send a message or submit an application.

## Run

Requires Node.js 20 or later.

```bash
npm install
npm run self-test
npm start
```

## MCP host configuration

Extract the folder, run `npm install`, then use the absolute path to
`server.mjs` in your MCP host configuration:

```json
{
  "mcpServers": {
    "ir35careers": {
      "command": "node",
      "args": ["/absolute/path/to/ir35careers-mcp/server.mjs"]
    }
  }
}
```

For local IR35Careers development only, set `IR35CAREERS_API_BASE` to an HTTP
localhost URL. All non-local base URLs must use HTTPS.
