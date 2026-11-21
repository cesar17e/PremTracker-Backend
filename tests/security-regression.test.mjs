import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

// Fake credentials plus blocked outbound fetches keep this suite off production services.
Object.assign(process.env, {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
  JWT_ACCESS_SECRET: "local-security-regression-secret",
  ACCESS_TOKEN_TTL: "15m",
  COOKIE_SECURE: "true",
  COOKIE_SAMESITE: "none",
  UPSTASH_REDIS_REST_URL: "https://redis.example.invalid",
  UPSTASH_REDIS_REST_TOKEN: "test-token",
  EMAIL_MODE: "live",
  RESEND_API_KEY: "re_test_only",
  EMAIL_FROM: "PremTracker <test@example.invalid>",
});

const { default: bcrypt } = await import("bcrypt");
const { default: express } = await import("express");
const { default: cookieParser } = await import("cookie-parser");
const { pool } = await import("../dist/db/pool.js");
const { default: limiter } = await import("../dist/config/upstash.js");
const user = {
  id: 1, email: "test@example.invalid", email_verified: true, is_admin: false,
  email_opt_in: true, time_zone: "UTC", password_hash: await bcrypt.hash("test-password", 4),
};
const sessions = new Map();
let queries = 0;
pool.query = async (sql, params = []) => {
  queries++;
  const query = sql.replace(/\s+/g, " ").trim();
  const result = (rows = []) => ({ rows, rowCount: rows.length });
  if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) return result();
  if (query.includes("FROM users")) return result([user]);
  if (query.startsWith("INSERT INTO refresh_tokens")) {
    sessions.set(params[1], { user_id: params[0], revoked: false });
    return result();
  }
  if (query.includes("FROM refresh_tokens")) {
    const session = sessions.get(params[0]);
    return result(session && !session.revoked ? [session] : []);
  }
  if (query.startsWith("UPDATE refresh_tokens")) {
    const session = sessions.get(params[0]);
    if (session) session.revoked = true;
    return result();
  }
  if (query.includes("FROM teams")) return result([{
    id: 21, external_team_id: 104, name: "Arsenal", short_name: "Arsenal",
    symbolic_name: "ARS", color: "#EF0107", away_color: null, logo_url: null, image_version: 1,
  }]);
  throw new Error(`Unexpected SQL in mocked database: ${query}`);
};

let limitMode = "allow";
let lastBucket;
limiter.limit = async (bucket) => {
  lastBucket = bucket;
  if (limitMode === "unavailable") throw new Error("Simulated limiter outage");
  return { success: limitMode !== "deny" };
};

const nativeFetch = globalThis.fetch;
const deliveries = [];
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? input);
  if (url.hostname === "127.0.0.1") return nativeFetch(input, options);
  if (url.origin === "https://api.resend.com" && url.pathname === "/emails") {
    deliveries.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: "mock-delivery" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`Outbound network blocked in tests: ${url.origin}`);
};

const { default: routes } = await import("../dist/routes/index.js");
const { errorHandler, notFoundHandler } = await import("../dist/middleware/errorHandler.js");
const { verifyAccessToken } = await import("../dist/utils/tokens.js");
const email = await import("../dist/services/email.service.js");

test("security dependency regressions (database, limiter, and email mocked)", async (t) => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api", routes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
  const request = (path, options) => fetch(base + path, options);
  const json = (body, headers = {}) => ({
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let accessToken;
  let refreshCookie;

  await t.test("health stays DB-free and protected route groups reject anonymous requests", async () => {
    const before = queries;
    const health = await request("/api/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    for (const path of ["/api/auth/me", "/api/teams", "/api/me/settings"]) {
      assert.equal((await request(path)).status, 401);
    }
    assert.equal((await request("/api/admin/sync-games", { method: "POST" })).status, 401);
    assert.equal(queries, before);
    assert.equal((await request("/api/unknown")).status, 404);
    assert.equal(app.get("query parser"), "simple");
  });

  await t.test("JSON login, JWT, cookies and numeric proxy trust remain compatible", async () => {
    const response = await request("/api/auth/login", json({ email: user.email, password: "test-password" }, {
      "x-forwarded-for": "198.51.100.8, 203.0.113.9",
    }));
    assert.equal(response.status, 200);
    accessToken = (await response.json()).accessToken;
    assert.equal(verifyAccessToken(accessToken).sub, "1");
    const cookie = response.headers.get("set-cookie");
    for (const flag of ["HttpOnly", "Secure", "SameSite=None", "Path=/api/auth"]) assert(cookie.includes(flag));
    refreshCookie = cookie.split(";")[0];
    assert.equal(lastBucket, "route_/api/auth/login:ip_203.0.113.9");
  });

  await t.test("authenticated teams/settings/admin routes still match and enforce permissions", async () => {
    const options = { headers: { authorization: `Bearer ${accessToken}` } };
    assert.equal((await request("/api/auth/me", options)).status, 200);
    const teams = await request("/api/teams", options);
    assert.equal(teams.status, 200);
    assert.equal((await teams.json())[0].symbolicName, "ARS");
    assert.equal((await request("/api/me/settings", options)).status, 200);
    for (const route of ["summary", "matches", "form", "trends", "fixture-difficulty"]) {
      assert.equal((await request(`/api/teams/invalid/${route}`, options)).status, 400);
    }
    assert.equal((await request("/api/admin/sync-games", { ...options, method: "POST" })).status, 403);
    assert.equal((await request("/api/auth/me", { headers: { authorization: "Bearer invalid" } })).status, 401);
  });

  await t.test("refresh rotates cookies, rejects reuse, and logout revokes the new session", async () => {
    const options = { method: "POST", headers: { cookie: refreshCookie } };
    const response = await request("/api/auth/refresh", options);
    assert.equal(response.status, 200);
    assert.equal(verifyAccessToken((await response.json()).accessToken).sub, "1");
    const rotated = response.headers.get("set-cookie").split(";")[0];
    assert.notEqual(rotated, refreshCookie);
    assert.equal((await request("/api/auth/refresh", options)).status, 401);
    const logout = await request("/api/auth/logout", { method: "POST", headers: { cookie: rotated } });
    assert.equal(logout.status, 200);
    assert(logout.headers.get("set-cookie").includes("Expires="));
    assert.equal((await request("/api/auth/refresh", { method: "POST", headers: { cookie: rotated } })).status, 401);
  });

  await t.test("malformed, oversized, and compressed JSON cannot bypass parsing or crash the server", async () => {
    const headers = { "content-type": "application/json" };
    assert.equal((await request("/api/auth/login", { method: "POST", headers, body: "{" })).status, 400);
    assert.equal((await request("/api/auth/login", json({ data: "x".repeat(1024 * 1024) }))).status, 413);
    const credentials = { email: user.email, password: "test-password" };
    const compressed = gzipSync(JSON.stringify(credentials));
    const options = { method: "POST", headers: { ...headers, "content-encoding": "gzip" } };
    assert.equal((await request("/api/auth/login", { ...options, body: compressed })).status, 200);
    const malformed = await request("/api/auth/login", {
      ...options, body: Buffer.concat([compressed, Buffer.from("trailing invalid gzip bytes")]),
    });
    assert([200, 400].includes(malformed.status));
    await malformed.text();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await request("/api/health")).status, 200);
  });

  await t.test("limiter denial and sensitive-route outage protection remain active", async () => {
    try {
      limitMode = "deny";
      assert.equal((await request("/api/auth/login", json({}))).status, 429);
      limitMode = "unavailable";
      assert.equal((await request("/api/auth/login", json({}))).status, 503);
    } finally { limitMode = "allow"; }
  });

  await t.test("Resend send helpers retain their API contract without delivering real email", async () => {
    const link = "https://example.invalid/token";
    assert.deepEqual(await email.sendVerifyEmail(user.email, link), { mode: "live", sent: true });
    assert.deepEqual(await email.sendPasswordResetEmail(user.email, link), { mode: "live", sent: true });
    assert.deepEqual(await email.sendFixtureDigestEmail(user.email, { timeZone: "UTC", items: [] }), { mode: "live", sent: true });
    assert.equal(deliveries.length, 3);
    for (const delivery of deliveries) {
      assert.deepEqual(delivery.to, [user.email]);
      assert.equal(typeof delivery.html, "string");
    }
    process.env.EMAIL_MODE = "demo";
    assert.deepEqual(await email.sendVerifyEmail(user.email, link), { mode: "demo", verifyLink: link });
    assert.equal(deliveries.length, 3);
  });
});
