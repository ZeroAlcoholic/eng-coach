// Entry for the coach app (coach.html). No StrictMode — it owns a live audio
// session + WebSocket, and StrictMode's double-invoke would double-connect.

import { createRoot } from "react-dom/client";

import "../../app.css";
import { CoachApp } from "./CoachApp";

const el = document.getElementById("coach-root");
if (!el) throw new Error("missing #coach-root element in coach.html");
createRoot(el).render(<CoachApp />);
