// Ask once more when a reply arrives but can't be read (#603: gpt-oss wrote broken
// JSON, or nothing, on about 1 in 15 Organize calls). `read` returns what the
// screen needs, or null. A provider error is not retried here: callAI has
// already tried the other providers.
export async function retryUnreadable(call, read) {
  for (let attempt = 0; ; attempt++) {
    const raw = await call();
    let out = null;
    try { out = read(raw); } catch { out = null; }
    if (out || attempt >= 1) return out;
  }
}
