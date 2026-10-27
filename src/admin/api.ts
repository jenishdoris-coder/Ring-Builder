import type { RingCatalog } from "../types/catalog";
export interface AdminSession { username: string; csrf: string; expires: number; }
export interface AdminState {
  active: RingCatalog; draft: RingCatalog; revision: number; hasDraft: boolean; savedAt: string | null; publishedAt: string | null; baseReleaseId: string;
  activity: { type: string; message: string; username: string; createdAt: string }[];
  storage: { count: number; bytes: number }; connections: { database: boolean; uploads: boolean };
}
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export const adminRequest = async <T>(action: string, session?: AdminSession | null, data?: unknown): Promise<T> => {
  const response = await fetch(`/api/admin?action=${action}`, { method: data === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json", ...(data === undefined ? {} : { "Content-Type": "application/json", "X-Admin-CSRF": session?.csrf || "" }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json().catch(() => ({ error: "The admin server did not return a valid response." }));
  if (!response.ok) throw new ApiError(result.error || "The request failed.", response.status);
  return result as T;
};
export const uploadAsset = async (file: File, kind: "model" | "image", session: AdminSession, progress: (percent: number) => void): Promise<{ url: string; filename: string }> => {
  if (kind === "model") {
    const header = new DataView(await file.slice(0, 12).arrayBuffer());
    if (header.byteLength !== 12 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== file.size) throw new Error("Choose a complete GLB 2.0 file.");
  }
  const ticket = await adminRequest<{ id: string; uploadUrl: string; contentType: string }>("upload", session, { filename: file.name, bytes: file.size, kind });
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", ticket.uploadUrl);
    request.setRequestHeader("Content-Type", ticket.contentType);
    request.setRequestHeader("Cache-Control", "public, max-age=31536000, immutable");
    request.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("The upload failed. Check the Cloudflare upload origin settings."));
    request.onerror = () => reject(new Error("Could not reach Cloudflare. Check your connection and upload origin settings."));
    request.timeout = 180000;
    request.ontimeout = () => reject(new Error("The upload timed out. Please try again."));
    request.send(file);
  });
  return adminRequest("upload-complete", session, { id: ticket.id });
};
export const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`;
export const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not saved yet";
