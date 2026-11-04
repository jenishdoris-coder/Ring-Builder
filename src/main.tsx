import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { StudioStartup } from "./components/UI/StudioStartup";
import deployment from "./config/deployment.json";
import "./styles/style.css";

const isAdmin = /^\/admin(?:\/|$)/.test(window.location.pathname);
if (deployment.assetBaseUrl) {
  const connection = document.createElement("link");
  connection.rel = "preconnect";
  connection.href = new URL(deployment.assetBaseUrl).origin;
  connection.crossOrigin = "anonymous";
  document.head.appendChild(connection);
}
// Recorded-video experiments stay local and are excluded from production.
const localVideoPage = "/src/components/VideoTryOnPage.tsx";
const Application = React.lazy(() => isAdmin ? import("./admin/AdminApp") : import.meta.env.DEV && location.pathname === "/video-test" ? import(/* @vite-ignore */ localVideoPage) : location.pathname === "/hand-fit" ? import("./components/HandFitPage") : ["/photo-fit", "/env-test"].includes(location.pathname) ? import("./components/PhotoFitPage") : import("./App"));

ReactDOM.createRoot(
  document.getElementById("canvas-container") as HTMLElement,
).render(
  <React.StrictMode>
    <React.Suspense fallback={isAdmin ? <div role="status" style={{ padding: 32, color: "#8a95a2", font: "13px Segoe UI, sans-serif" }}>Opening admin…</div> : <StudioStartup />}><Application /></React.Suspense>
    {import.meta.env.PROD && !isAdmin && <Analytics />}
    {import.meta.env.PROD && !isAdmin && <SpeedInsights />}
  </React.StrictMode>,
);
