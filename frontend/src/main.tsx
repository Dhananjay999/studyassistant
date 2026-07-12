import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "@fontsource-variable/sora";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App.tsx";
import { initAnalytics } from "./lib/analytics";
import { initAppMode } from "./lib/appMode";
import { attachGlobalRipple } from "./lib/ripple";

// Before first paint: detect native-app (WebView) mode and install the
// delegated touch ripple so every tappable gets native-feeling feedback.
initAppMode();
attachGlobalRipple();

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Analytics />
  </>,
);

initAnalytics();
