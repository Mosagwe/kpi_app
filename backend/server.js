import path from "node:path";
import { createServices } from "./src/application/createServices.js";
import { loadEnv } from "./src/infrastructure/config/env.js";
import {
  closeDatabase,
  databaseStatus,
  getDatabase
} from "./src/infrastructure/database/mongoDatabase.js";
import { createApp } from "./src/interfaces/http/createApp.js";
import { initializeAuth } from "./lib/auth.js";
import { initializeSettings } from "./lib/settings.js";

const { rootDir, env } = loadEnv();
const port = Number(env.PORT) || 3000;
const db = await getDatabase();

await initializeAuth(db);
await initializeSettings(db);

const app = createApp({
  db,
  distDir: path.join(rootDir, "frontend", "dist"),
  services: createServices({ env }),
  infrastructure: {
    databaseStatus
  }
});

app.listen(port, () => {
  console.log(`KPI Appraisal Assistant running at http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await closeDatabase().catch(() => {});
    process.exit(0);
  });
}
