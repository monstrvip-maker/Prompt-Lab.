import { initLocalAI } from "./ai.js";
window.promptLabAI = initLocalAI();
await import("./app.js");
