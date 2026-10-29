// One SQLite-backed Durable Object owns all users' reservations, so parallel
// requests to different providers share the same atomic daily budget.
export class AITokenLedger {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.env = env;
    this.sql.exec("CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, uid TEXT NOT NULL, tokens INTEGER NOT NULL, PRIMARY KEY (day, uid))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, day TEXT NOT NULL, uid TEXT NOT NULL, estimate INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0)");
  }

  limits() {
    const user = Number(this.env.AI_USER_DAILY_TOKENS ?? 60000);
    const pool = Number(this.env.AI_POOL_DAILY_TOKENS ?? 200000);
    if (![user, pool].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error("Invalid token budgets");
    return { user, pool };
  }

  remaining(uid, day) {
    const limits = this.limits();
    const used = this.sql.exec("SELECT tokens FROM usage WHERE day = ? AND uid = ?", day, uid).toArray()[0]?.tokens ?? 0;
    const poolUsed = this.sql.exec("SELECT COALESCE(SUM(tokens), 0) AS tokens FROM usage WHERE day = ?", day).toArray()[0].tokens;
    return { user: Math.max(0, limits.user - used), pool: Math.max(0, limits.pool - poolUsed) };
  }

  async fetch(request) {
    if (request.method !== "POST") return Response.json({}, { status: 405 });
    const body = await request.json();
    const path = new URL(request.url).pathname;
    const day = new Date().toISOString().slice(0, 10);
    if (path === "/reserve") {
      if (typeof body.uid !== "string" || !body.uid || body.uid.length > 128 || !Number.isSafeInteger(body.tokens) || body.tokens < 1 || body.tokens > 1000000) {
        return Response.json({}, { status: 400 });
      }
      return this.storage.transactionSync(() => {
        const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        this.sql.exec("DELETE FROM reservations WHERE day < ?", cutoff);
        this.sql.exec("DELETE FROM usage WHERE day < ?", cutoff);
        const remaining = this.remaining(body.uid, day);
        const code = body.tokens > remaining.user ? "daily_cap" : body.tokens > remaining.pool ? "pool_empty" : null;
        if (code) return Response.json({ code, remaining: Math.min(remaining.user, remaining.pool) }, { status: 429 });
        const id = crypto.randomUUID();
        this.sql.exec("INSERT INTO usage (day, uid, tokens) VALUES (?, ?, ?) ON CONFLICT(day, uid) DO UPDATE SET tokens = tokens + excluded.tokens", day, body.uid, body.tokens);
        this.sql.exec("INSERT INTO reservations (id, day, uid, estimate) VALUES (?, ?, ?, ?)", id, day, body.uid, body.tokens);
        return Response.json({ id, remaining: Math.min(remaining.user, remaining.pool) - body.tokens });
      });
    }
    if (path === "/settle") {
      if (typeof body.id !== "string") return Response.json({}, { status: 400 });
      return this.storage.transactionSync(() => {
        const reservation = this.sql.exec("SELECT * FROM reservations WHERE id = ?", body.id).toArray()[0];
        if (!reservation) return Response.json({}, { status: 404 });
        if (!reservation.closed) {
          // Missing/invalid usage retains the reservation; errors explicitly
          // settle to zero. A duplicate settlement never charges/refunds twice.
          const actual = Number.isSafeInteger(body.actual) && body.actual >= 0 ? body.actual : reservation.estimate;
          this.sql.exec("UPDATE usage SET tokens = tokens + ? WHERE day = ? AND uid = ?", actual - reservation.estimate, reservation.day, reservation.uid);
          this.sql.exec("UPDATE reservations SET closed = 1 WHERE id = ?", body.id);
        }
        const remaining = this.remaining(reservation.uid, day);
        return Response.json({ remaining: Math.min(remaining.user, remaining.pool) });
      });
    }
    return Response.json({}, { status: 404 });
  }
}
