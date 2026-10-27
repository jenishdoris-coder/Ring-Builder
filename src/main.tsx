import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./styles/style.css";

const isAdmin = /^\/admin(?:\/|$)/.test(window.location.pathname);
const Application = React.lazy(() => isAdmin ? import("./admin/AdminApp") : import("./App"));

ReactDOM.createRoot(
  document.getElementById("canvas-container") as HTMLElement,
).render(
  <React.StrictMode>
    <React.Suspense fallback={<div role="status" style={{ padding: 32, color: "#8a95a2", font: "13px Segoe UI, sans-serif" }}>Opening your studio…</div>}><Application /></React.Suspense>
    {import.meta.env.PROD && !isAdmin && <Analytics />}
    {import.meta.env.PROD && !isAdmin && <SpeedInsights />}
  </React.StrictMode>,
);
