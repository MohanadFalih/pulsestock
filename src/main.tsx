import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { loadLiveData } from "./data/liveSync";

/**
 * Bootstrap: try to load live Odoo data (public/data/live.json, written by
 * scripts/odoo_sync.py) BEFORE first render. The loader swaps the exported
 * `products` array + aggregates in place on success; on failure or the 8s
 * timeout the app silently renders the mock dataset.
 */
async function bootstrap() {
  await loadLiveData();
  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
