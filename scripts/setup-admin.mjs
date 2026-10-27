import { randomBytes, scryptSync } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { loadCloudEnv } from "./cloud-env.mjs";
loadCloudEnv();
if (process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_SESSION_SECRET) {
  console.log("Admin access is already configured. Existing credentials were retained.");
} else {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = randomBytes(18).toString("base64url"), salt = randomBytes(16).toString("hex");
  const values = { ADMIN_USERNAME: username, ADMIN_PASSWORD_HASH: `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`, ADMIN_SESSION_SECRET: randomBytes(48).toString("base64url") };
  const missing = Object.entries(values).filter(([key]) => !process.env[key]);
  await appendFile(".env", `\n# Store admin — server-side only\n${missing.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/admin-access.private.txt", `Ring Builder — local store admin\n\nURL: http://localhost:5173/admin\nUsername: ${username}\nPassword: ${password}\n\nKeep this file private. It is excluded from Git.\nFor deployment, add ADMIN_USERNAME, ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET from .env to the server environment.\n`, { mode: 0o600 });
  console.log("Admin credentials configured in .env. Sign-in details saved to artifacts/admin-access.private.txt. Restart the development server.");
}
