import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { SpellLab } from "./scene/spell/SpellLab";
import "./style.css";

// ?spell opens the VFX lab in isolation (see src/scene/spell/SpellLab.tsx).
const spellLab = new URLSearchParams(location.search).has("spell");
createRoot(document.getElementById("root")!).render(spellLab ? <SpellLab /> : <App />);
