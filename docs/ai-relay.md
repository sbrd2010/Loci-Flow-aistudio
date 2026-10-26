# Loci AI relay (Cloudflare AI, NVIDIA, OpenRouter, Groq, Ollama, Gemini, Z.ai)

A small Cloudflare Worker, `loci-ai` (code in `ai-proxy/`), that lets the app use free AI providers without putting their keys in the app's public code:

- **Cloudflare AI** (Workers AI): Cloudflare's own models, `gpt-oss-120b` by default, the same model Groq runs. No key: it uses the Cloudflare account's free daily allowance (10,000 "neurons" a day, reset at 00:00 UTC).
- **NVIDIA** (build.nvidia.com): `nvidia/nemotron-3.5-lightning-30b-a3b` by default (NVIDIA retired `openai/gpt-oss-120b` on 2026-09-03; `deepseek-ai/deepseek-v4.1-flash` and `google/gemma-4-31b-it` both timed out past the app's 30-second limit). NVIDIA's API refuses calls from a browser (#356), so the relay calls it instead and keeps the key on Cloudflare.
- **Groq**: your Groq key, kept on Cloudflare. `openai/gpt-oss-120b` by default (`GROQ_MODEL` changes it).
- **Ollama Cloud**: your Ollama key, kept on Cloudflare. `gpt-oss:120b` by default (`OLLAMA_MODEL` changes it), the model Groq runs. The free plan's allowance refills every four weeks; in the U8 check (#555) 37 Coach-sized requests used 0.2% of it. Check that Ollama's terms allow one key behind an app before adding it.
- **Gemini**: your Gemini key, kept on Cloudflare, through Google's OpenAI-style endpoint. `gemini-2.5-flash-lite` by default; the repository secret `VITE_GEMINI_MODEL` picks another (the name as Google AI Studio shows it) for both the relay and someone's own key.
- **Z.ai**: your Z.ai key, kept on Cloudflare. `glm-4.7-flash` by default (`ZAI_MODEL` changes it). Its free tier answers one request at a time per key, shared by every user through the relay, and the app only sends it short chats; it is Auto's last resort.
- **OpenRouter**: your OpenRouter key, kept on Cloudflare. Free models only (`openrouter/free` by default), so the key can never be billed through the relay, even if credit is added later. Someone who adds their own OpenRouter key in Settings still goes direct with it.

Only someone signed in to Loci with Google gets through: the app sends its Firebase sign-in token, and the relay checks it. There is no per-person limit yet (that is PR 9, #570). Prompts and replies pass through; the relay does not log or store them.

In the app, Ollama Cloud, Cloudflare AI and NVIDIA appear in **Settings → AI provider**, Groq, Gemini, OpenRouter and Z.ai show as "Built in", and **Auto** keeps its order: Groq, Ollama Cloud, Gemini, OpenRouter, Cloudflare AI, NVIDIA, Z.ai. Someone who adds their own Groq, Gemini, OpenRouter or Z.ai key in Settings goes direct with it.

**No AI key is built into the app any more.** A `VITE_..._KEY` in the build can be read by anyone who opens the app, so the deploy workflows no longer pass `VITE_GROQ_KEY`, `VITE_GEMINI_KEY`, `VITE_CEREBRAS_KEY` or `VITE_ZAI_KEY`. Cerebras is offered only to someone who adds their own (paid) key. Someone not signed in has no built-in AI.

## Setup (no terminal)

Use the same GitHub page as for the other secrets: GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. **Never paste a key into a chat or an issue**, only into the GitHub secret box.

**1. Cloudflare secrets.** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are already there from the connector (`docs/mcp-connector.md`, step 1). Nothing to do.

**2. NVIDIA key (optional).**
1. Open build.nvidia.com and sign in.
2. Open your account menu (top right) → **API Keys** → **Generate API Key**. Copy it (it starts with `nvapi-`).
3. Add it as the secret `AI_NVIDIA_KEY`.

**3. OpenRouter key (optional).** openrouter.ai → **Keys** → **Create Key**, copy it (starts with `sk-or-`), and add it as the secret `AI_OPENROUTER_KEY`.

**3b. Groq, Gemini and Z.ai keys.** Make **new** keys, not the ones that were in `VITE_GROQ_KEY` / `VITE_GEMINI_KEY`: those were in the public app, so treat them as known to anyone.
- Groq: console.groq.com → **API Keys** → **Create API Key** (starts with `gsk_`) → secret `AI_GROQ_KEY`.
- Gemini: aistudio.google.com → **Get API key** → **Create API key** (starts with `AIza`) → secret `AI_GEMINI_KEY`. Make it in a Google Cloud project **without billing** (not the Firebase project if that is on the Blaze plan): until PR 9 (#570) anyone signed in can use it, and a billed key would charge you.
- Z.ai: z.ai → **API Keys** → create a key → secret `AI_ZAI_KEY`.
- Ollama (optional): ollama.com → **Settings** → **Keys** → create a key → secret `AI_OLLAMA_KEY`.
- Once the app answers through the relay (step 6), delete the old keys at Groq, Google and Z.ai, and delete the GitHub secrets `VITE_GROQ_KEY`, `VITE_GEMINI_KEY`, `VITE_CEREBRAS_KEY` and `VITE_ZAI_KEY`.

Without a key, that provider answers "not set up" and the app moves on to the next one. Cloudflare AI needs no key. Deleting a key from GitHub later does not remove it from the Worker: delete it there too (Cloudflare dashboard → **Workers & Pages** → `loci-ai` → **Settings** → **Variables and Secrets**). The same goes for `VITE_GEMINI_MODEL`: the relay keeps the last model it was given (stored there as `GEMINI_MODEL`) until you delete it on the Worker.

**4. Press the button.** GitHub repo → **Actions** → **Deploy the AI relay** → **Run workflow**. When it finishes, open the run: the summary shows the relay address (`https://loci-ai.<name>.workers.dev`).

**5. Tell the app.** Add that address, with no slash at the end, as the secret `VITE_AI_RELAY_URL`. Then **Actions** → **Deploy to Firebase Hosting** → **Run workflow** (or merge any PR).

**6. Check it.** Hard-refresh Loci. **Settings → AI provider**: choose **Cloudflare AI**, turn on **Only use my provider**, and send one Coach message. Then the same with **NVIDIA**, **Ollama Cloud**, **OpenRouter**, **Groq** and **Gemini**. Z.ai's limit is too small for a Coach message, so check it with **Z.ai** chosen and a task's suggested steps instead. First remove any key of your own in **Settings → AI Keys**, or the app goes straight to the provider and the check proves nothing about the relay. Afterwards choose **Auto** again and turn the switch off. If one fails, the line in brackets after the error is that provider's own reason.

If the deploy fails with a permission error about AI, edit the Cloudflare token (profile → **API Tokens** → the token → **Edit**) and add **Account → Workers AI → Edit**. Not checked from a real deployment yet; the run log names any problem.

## Stay on the free Cloudflare plan

On the **free** Workers plan, Cloudflare AI simply stops for the day when the 10,000-neuron allowance is used up. On the **paid** Workers plan, use beyond the allowance is **billed with no cap**. Anyone with a Google account can sign in to Loci, and there is no per-person limit until PR 9 (#570), so do not move this Cloudflare account to the paid plan before PR 9. NVIDIA's trial and OpenRouter's free models cannot charge you.

## Changing models

The defaults are set in `ai-proxy/src/index.js`. To use another model without a code change, add a variable to `ai-proxy/wrangler.jsonc` under `vars`, for example `"NVIDIA_MODEL": "meta/llama-3.3-70b-instruct"` or `"CLOUDFLARE_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"`, and press the button again. `OPENROUTER_MODEL` must be a free model (`openrouter/free` or a name ending in `:free`); anything else is ignored. NVIDIA withdraws free models now and then; a withdrawn model shows as an error with its HTTP status.

## Turning it off

- In the app only: delete the secret `VITE_AI_RELAY_URL` and run **Deploy to Firebase Hosting**. Both providers disappear from Settings and from Auto.
- Everywhere: Cloudflare dashboard → **Workers & Pages** → `loci-ai` → **Settings** → **Delete**.

## If someone hammers it

The address is in the app's code, but every request needs a valid Loci sign-in, so a stranger is refused before any AI is called. Anyone who signs in to Loci can use the shared free allowance until PR 9 adds a per-person limit (#570). If a burst of refused requests ever used up the Worker's free request allowance, AI through the relay would stop until 00:00 UTC; the rest of the app is unaffected.

## Working on it

`cd ai-proxy && npm test`. For a local run: `npx wrangler dev` (the AI binding needs a Cloudflare login).
