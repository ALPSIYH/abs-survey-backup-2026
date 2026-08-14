import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "../app/App";
import "../app/globals.css";
import type { CloudCatalog } from "../app/api";
import catalog from "../public/data/catalog.json";

const root = document.getElementById("root");
if (!root) throw new Error("Static application root is missing");

createRoot(root).render(
  <StrictMode>
    <App initialCatalog={catalog as CloudCatalog} />
  </StrictMode>,
);
