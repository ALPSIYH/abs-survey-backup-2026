import App from "./App";
import catalog from "../public/data/catalog.json";
import type { CloudCatalog } from "./api";

export default function Home() {
  return <App initialCatalog={catalog as CloudCatalog} />;
}
