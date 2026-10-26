# Loci AI relay (Cloudflare AI and NVIDIA)

A small Cloudflare Worker, `loci-ai` (code in `ai-proxy/`), that lets the app use free AI providers without putting their keys in the app's public code:

- **Cloudflare AI** (Workers AI): Cloudflare's own models, `gpt-oss-120b` by default, the same model Groq runs. No key: it uses the Cloudflare account's free daily allowance (10,000 "neurons" a day, reset at 00:00 UTC).
- **NVIDIA** (build.nvidia.com): `openai/gpt-oss-120b` by default. NVIDIA's API refuses calls from a browser (#356), so the relay calls it instead and keeps the key on Cloudflare.
- **OpenRouter**: your OpenRouter key, kept on Cloudflare. Free models only (`openrouter/free` by default), so the key can never be billed through the relay, even if credit is added later. Someone who adds their own OpenRouter key in Settings still goes direct with it.

Only someone signed in to Loci gets through: the app sends its Firebase sign-in token, and the relay checks it. There is no per-person limit yet (that is PR 9, #570). Prompts and replies pass through; the relay does not log or store them.

In the app, Cloudflare AI and NVIDIA appear in **Settings → AI provider**, OpenRouter shows as "Built in", and **Auto** tries them after Groq and Gemini.

## Setup (no terminal)

Use the same GitHub page as for the other secrets: GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. **Never paste a key into a chat or an issue**, only into the GitHub secret box.

**1. Cloudflare secrets.** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are already there from the connector (`docs/mcp-connector.md`, step 1). Nothing to do.

**2. NVIDIA key (optional).**
1. Open build.nvidia.com and sign in.
2. Open your account menu (top right) → **API Keys** → **Generate API Key**. Copy it (it starts with `nvapi-`).
3. Add it as the secret `AI_NVIDIA_KEY`.

**3. OpenRouter key (optional).** openrouter.ai → **Keys** → **Create Key**, copy it (starts with `sk-or-`), and add it as the secret `AI_OPENROUTER_KEY`.

Without a key, that provider answers "not set up" and the app moves on to the next one. Cloudflare AI needs no key.

**4. Press the button.** GitHub repo → **Actions** → **Deploy the AI relay (Cloudflare AI and NVIDIA)** → **Run workflow**. When it finishes, open the run: the summary shows the relay address (`https://loci-ai.<name>.workers.dev`).

**5. Tell the app.** Add that address, with no slash at the end, as the secret `VITE_AI_RELAY_URL`. Then **Actions** → **Deploy to Firebase Hosting** → **Run workflow** (or merge any PR).

**6. Check it.** Hard-refresh Loci. **Settings → AI provider**: choose **Cloudflare AI**, turn on **Only use my provider**, and send one Coach message. Then the same with **NVIDIA** and **OpenRouter**. Afterwards choose **Auto** again and turn the switch off. If one fails, the line in brackets after the error is that provider's own reason.

If the deploy fails with a permission error about AI, edit the Cloudflare token (profile → **API Tokens** → the token → **Edit**) and add **Account → Workers AI → Edit**. Not checked from a real deployment yet; the run log names any problem.

## Changing models

The defaults are set in `ai-proxy/src/index.js`. To use another model without a code change, add a variable to `ai-proxy/wrangler.jsonc` under `vars`, for example `"NVIDIA_MODEL": "meta/llama-3.3-70b-instruct"` or `"CLOUDFLARE_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"`, and press the button again. `OPENROUTER_MODEL` must be a free model (`openrouter/free` or a name ending in `:free`); anything else is ignored. NVIDIA withdraws free models now and then; a withdrawn model shows as an error with its HTTP status.

## Turning it off

- In the app only: delete the secret `VITE_AI_RELAY_URL` and run **Deploy to Firebase Hosting**. Both providers disappear from Settings and from Auto.
- Everywhere: Cloudflare dashboard → **Workers & Pages** → `loci-ai` → **Settings** → **Delete**.

## If someone hammers it

The address is in the app's code, but every request needs a valid Loci sign-in, so a stranger is refused before any AI is called. Anyone who signs in to Loci can use the shared free allowance until PR 9 adds a per-person limit (#570). If a burst of refused requests ever used up the Worker's free request allowance, AI through the relay would stop until 00:00 UTC; the rest of the app is unaffected.

## Working on it

`cd ai-proxy && npm test`. For a local run: `npx wrangler dev` (the AI binding needs a Cloudflare login).
