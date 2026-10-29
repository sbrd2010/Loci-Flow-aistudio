// Personal keys belong to the person who entered them, even on a shared browser.
// Keep harmless device preferences (theme, provider selection) on sign-out.
export function clearPersonalAIKeys(storage) {
  try { if (storage === undefined) storage = globalThis.localStorage; } catch { return; }
  if (!storage) return;
  for (const provider of ["groq", "gemini", "cerebras", "zai", "openrouter", "nvidia"]) {
    try { storage.removeItem(`loci_${provider}_key`); } catch { /* storage blocked */ }
  }
}
