import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));
const client = new Client({ name: "ir35careers-protocol-test", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  const expected = ["analyse_public_job_url", "explain_ir35_evidence", "get_contract", "search_contracts"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected tools: ${names.join(", ")}`);
  }

  const result = await client.callTool({
    name: "explain_ir35_evidence",
    arguments: { status: "tbc" },
  });
  if (result.isError || !result.structuredContent) {
    throw new Error("Evidence tool did not return structured content");
  }

  process.stdout.write(`${JSON.stringify({ ok: true, tools: names })}\n`);
} finally {
  await client.close();
}
