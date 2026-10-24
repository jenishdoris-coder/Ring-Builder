import deployment from "./deployment.json";

/** Public asset addresses only. Credentials are never imported into the browser. */
export const assetUrl = (path: string) => {
  if (/^(?:https?:|blob:|data:)/i.test(path) || !deployment.assetBaseUrl) return path;
  return `${deployment.assetBaseUrl.replace(/\/+$/, "")}/${path.replace(/^\//, "").split("/").map(encodeURIComponent).join("/")}`;
};
