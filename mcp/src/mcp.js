import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerTools } from "./tools.js";

export const READ_SCOPE = "mcp:read";

const INSTRUCTIONS = [
  "Loci is the user's personal planner: work is held at horizons (today, week, month, quarter, half-year) and in named fronts, each with its own deadline.",
  "Start with get_overview, then use the page tools: get_today, get_day_map, get_plan, get_mind_box, get_week, get_stuck, get_settings.",
  "These tools only read. Say so if asked to change the plan; you cannot.",
  "Dates are in the user's time zone. Judge the plan from the data, and say when the data is too thin to judge.",
].join(" ");

function createServer(env, deps) {
  const server = new McpServer({ name: "loci", version: "0.2.0" }, { instructions: INSTRUCTIONS });
  registerTools(server, env, deps);
  return server;
}

// Called with a verified token's context. The uid comes from the token, and is
// checked against the configured one again so removing a user from the config
// cuts off tokens already issued to them.
export async function handleMcp(request, env, ctx, deps = {}) {
  const uid = ctx.props?.uid;
  if (!uid || uid !== env.LOCI_UID || !ctx.auth?.scope?.includes(READ_SCOPE)) {
    return new Response("Forbidden", { status: 403 });
  }
  // One server and transport per request: nothing is remembered between calls.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createServer(env, { ...deps, uid }).connect(transport);
  return transport.handleRequest(request);
}
