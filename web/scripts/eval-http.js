// One request to a provider through curl, for the Coach evaluation scripts (#594).
// curl goes through the session's proxy, which adds the key in a Claude Code cloud
// session; locally the provider's key is read from its env variable and handed to
// curl on stdin, so it never appears on a command line or in a log.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function send(provider, body, dir) {
  const req = join(dir, ".req.json"), res = join(dir, ".res.json"), hdr = join(dir, ".hdr.txt");
  writeFileSync(req, JSON.stringify(body));
  for (const f of [res, hdr]) if (existsSync(f)) writeFileSync(f, "");
  const key = process.env[provider.keyEnv];
  const started = Date.now();
  let code = 0;
  try {
    code = Number(execFileSync("curl", ["-sS", "--max-time", "30", "-o", res, "-D", hdr, "-w", "%{http_code}", "-H", "Content-Type: application/json",
      ...(key ? ["--config", "-"] : []), "--data-binary", `@${req}`, provider.url], { input: key ? `header = "Authorization: Bearer ${key}"\n` : undefined, encoding: "utf8" }));
  } catch { code = 0; } // timeout or network: the app gives up at 30 s too
  const raw = existsSync(res) ? readFileSync(res, "utf8") : "";
  const retryAfter = Number((existsSync(hdr) ? readFileSync(hdr, "utf8") : "").match(/^retry-after:\s*([\d.]+)/im)?.[1]) || null;
  let json = null;
  try {
    json = JSON.parse(raw);
    if (Array.isArray(json)) json = json[0];
    if (json?.result?.choices) json = json.result; // Cloudflare's REST API wraps the reply
  } catch { /* not JSON */ }
  return { code, json, raw, retryAfter, ms: Date.now() - started };
}
