import App from "./App";
import bundle from "../public/data/bundle.json";
import catalog from "../public/data/catalog.json";
import type { CloudCatalog, StaticDataBundle } from "./api";

export default function Home() {
  return (
    <App
      initialCatalog={catalog as CloudCatalog}
      initialDataBundle={bundle as StaticDataBundle}
    />
  );
}
