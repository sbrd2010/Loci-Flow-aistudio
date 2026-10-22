import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { readUserRecord } from "./firebase.js";
import { buildOverview } from "./overview.js";

export const READ_SCOPE = "mcp:read";

const INSTRUCTIONS = [
  "Loci is the user's personal planner: work is held at horizons (today, week, month, quarter, half-year) and in named fronts, each with its own deadline.",
  "These tools only read. Say so if asked to change the plan; you cannot.",
  "Dates are in the user's time zone. Judge the plan from the data, and say when the data is too thin to judge.",
].join(" ");

function createServer(env, deps) {
  const server = new McpServer({ name: "loci", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  server.registerTool(
    "get_overview",
    {
      title: "Loci overview",
      description:
        "A snapshot of the user's Loci plan right now: today's calendar date in their zone (and lociDay, the date their day counts as, which is still yesterday in the small hours if their day runs past midnight), their fronts (named pieces of work) with deadlines and days left, " +
        "open task counts per horizon, today's list (pinned task first, then the user's order) with estimates and total planned minutes, task deadlines that are overdue / due today / coming in 14 days, " +
        "and tasks completed per day over the last 7 days. A task with no date of its own takes its front's date (viaFront). " +
        "Read-only. Task and front titles are included as the user wrote them; chat history and Mind Box thoughts are never read.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const record = await readUserRecord(env, deps.uid, deps);
        const overview = buildOverview(record, deps.now ?? Date.now(), env.LOCI_TIMEZONE);
        return { content: [{ type: "text", text: JSON.stringify(overview) }] };
      } catch (err) {
        // Log the reason (status only, never data); tell the model something it can relay.
        console.error("get_overview failed:", err instanceof Error ? err.message : "unknown");
        return { isError: true, content: [{ type: "text", text: "Could not read the Loci plan just now. Try again in a moment." }] };
      }
    },
  );
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
