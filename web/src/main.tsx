import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { enrich } from "./lib/enrich";
import { readUrl, startUrlSync, useStore } from "./lib/store";
import type { RawData } from "./lib/types";
import "./index.css";

readUrl();
startUrlSync();

fetch(`${import.meta.env.BASE_URL}data.json`)
  .then((r) => {
    if (!r.ok) throw new Error(`data.json: HTTP ${r.status}`);
    return r.json() as Promise<RawData>;
  })
  .then((raw) => useStore.getState().setData(enrich(raw)))
  .catch((e) => useStore.getState().setError(String(e)));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
