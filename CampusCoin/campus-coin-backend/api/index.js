// Vercel serverless entry point — Vercel auto-detects /api/*.js files as
// functions. This just re-exports the Express app from src/index.js.
import app from "../src/index.js";
export default app;
