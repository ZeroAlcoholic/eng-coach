import { createRoot } from "react-dom/client";

import "../../app.css";
import { Launcher } from "./Launcher";

const el = document.getElementById("app-root");
if (!el) throw new Error("missing #app-root element");
createRoot(el).render(<Launcher />);
