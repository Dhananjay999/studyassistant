import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "@fontsource-variable/sora";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Analytics />
  </>
);