import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "@fontsource-variable/sora";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App.tsx";
import { initAnalytics } from "./lib/analytics";

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Analytics />
  </>,
);

initAnalytics();
