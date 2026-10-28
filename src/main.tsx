import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/instrument-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "ol/ol.css";
import "./index.css";
import App from "./App";
import { useUiStore } from "./state/uiStore";

// Persisted preferences hydrate synchronously from localStorage, so the saved
// theme can be painted before the first frame instead of flashing the default.
document.documentElement.dataset.theme = useUiStore.getState().theme;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
