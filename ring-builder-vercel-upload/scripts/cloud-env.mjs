import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { S3Client } from "@aws-sdk/client-s3";
import { setServers } from "node:dns";

export function loadCloudEnv() {
  if (existsSync(".env")) loadEnvFile(".env");
  // Only this Node process is affected; Windows' DNS settings stay unchanged.
  setServers((process.env.MONGODB_DNS_SERVERS || "1.1.1.1,8.8.8.8").split(",").map(value => value.trim()).filter(Boolean));
}

export function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function mongoDatabaseName() {
  return process.env.MONGODB_DB?.trim() || decodeURIComponent(new URL(required("MONGODB_URI")).pathname.replace(/^\//, "")) || "ring_builder";
}

export function createR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${required("CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: required("CLOUDFLARE_ACCESS_KEY_ID"), secretAccessKey: required("CLOUDFLARE_SECRET_ACCESS_KEY") },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
  });
}

export function safeError(error) {
  let message = `${error?.name ?? "Error"}${error?.code ? ` (${error.code})` : ""}: ${error?.message ?? "Operation failed"}`;
  for (const [name, value] of Object.entries(process.env)) {
    if (/SECRET|PASSWORD|MONGODB_URI|ACCESS_KEY_ID/.test(name) && value && value.length > 5) message = message.replaceAll(value, "[redacted]");
  }
  return message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, "[redacted MongoDB URI]");
}
