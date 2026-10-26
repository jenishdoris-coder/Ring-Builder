import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./styles/style.css";

ReactDOM.createRoot(
  document.getElementById("canvas-container") as HTMLElement,
).render(
  <React.StrictMode>
    <App />
    {import.meta.env.PROD && <Analytics />}
    {import.meta.env.PROD && <SpeedInsights />}
  </React.StrictMode>,
);
