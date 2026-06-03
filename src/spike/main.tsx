// Entry for the Path B spike page (spike.html). No StrictMode: the spike owns a
// live audio session + WebSocket via manual Start/Stop, and StrictMode's
// double-invoke would double-connect them.

import { createRoot } from "react-dom/client";

import { SpikeApp } from "./SpikeApp";

const el = document.getElementById("spike-root");
if (!el) throw new Error("missing #spike-root element in spike.html");
createRoot(el).render(<SpikeApp />);
