import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
const COOKIE = "ring_admin";
const lifetime = 8 * 60 * 60;
export const adminConfigured = () => Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_SESSION_SECRET && process.env.ADMIN_SESSION_SECRET.length >= 32);
export const equal = (left: string, right: string) => {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const sign = (value: string) => createHmac("sha256", process.env.ADMIN_SESSION_SECRET!).update(value).digest("base64url");
export const passwordMatches = (username: string, password: string) => {
  const [algorithm, salt, expected] = (process.env.ADMIN_PASSWORD_HASH || "").split(":");
  if (algorithm !== "scrypt" || !salt || !expected || password.length > 256) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  return equal(actual, expected) && equal(username, process.env.ADMIN_USERNAME || "");
};
export const newSession = () => {
  const session = { username: process.env.ADMIN_USERNAME!, csrf: randomBytes(24).toString("base64url"), expires: Date.now() + lifetime * 1000 };
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { session, cookie: `${body}.${sign(body)}` };
};
export const readSession = (request: IncomingMessage): { username: string; csrf: string; expires: number } | null => {
  if (!adminConfigured()) return null;
  const raw = request.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw || raw.length > 1024) return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature || !equal(signature, sign(body))) return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString());
    return session.username === process.env.ADMIN_USERNAME && typeof session.csrf === "string" && session.expires > Date.now() ? session : null;
  } catch { return null; }
};
export const writeSessionCookie = (request: IncomingMessage, response: ServerResponse, value: string, clear = false) => {
  const secure = process.env.VERCEL || request.headers["x-forwarded-proto"] === "https";
  response.setHeader("Set-Cookie", `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : lifetime}${secure ? "; Secure" : ""}`);
};
export const sameOrigin = (request: IncomingMessage) => {
  const origin = request.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === request.headers.host; } catch { return false; }
};
