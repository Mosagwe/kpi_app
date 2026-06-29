import express from "express";
import multer from "multer";
import path from "node:path";
import { authRoutes, requireAdmin, requireAuth } from "../../../lib/auth.js";
import { activateLicense, licenseStatus, requireActiveLicense } from "../../../lib/license.js";
import { getSettings, removeLogo, saveLogo, saveSettings } from "../../../lib/settings.js";
import { AppError } from "../../application/errors.js";

export function createApp({
  db,
  distDir,
  services,
  infrastructure
}) {
  const app = express();
  const auth = authRoutes(db);
  const authenticated = (req, res, next) => requireAuth(db)(req, res, next);
  const activeLicense = (req, res, next) => requireActiveLicense(db)(req, res, next);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  });

  app.use(express.json({ limit: "2mb" }));
  app.get("/favicon.ico", (_req, res) => {
    res.type("image/svg+xml").sendFile(path.join(distDir, "favicon.svg"));
  });
  app.use(express.static(distDir));

  app.get("/api/config", (_req, res) => {
    res.json(services.config.getClientConfig());
  });

  app.get("/api/database/status", async (_req, res) => {
    const status = await infrastructure.databaseStatus();
    res.status(status.connected ? 200 : 503).json(status);
  });

  app.post("/api/auth/register", (req, res, next) => auth.register(req, res, next));
  app.post("/api/auth/login", (req, res, next) => auth.login(req, res, next));
  app.post("/api/auth/logout", (req, res, next) => auth.logout(req, res, next));
  app.get("/api/auth/me", authenticated, (req, res, next) => auth.me(req, res, next));
  app.patch("/api/auth/profile", authenticated, (req, res, next) => auth.profile(req, res, next));
  app.patch("/api/auth/password", authenticated, (req, res, next) => auth.password(req, res, next));
  app.get("/api/users", authenticated, requireAdmin, (req, res, next) => auth.users(req, res, next));
  app.post("/api/users", authenticated, requireAdmin, (req, res, next) => auth.createUser(req, res, next));
  app.patch("/api/users/:id/role", authenticated, requireAdmin, (req, res, next) => auth.setRole(req, res, next));
  app.patch("/api/users/:id/active", authenticated, requireAdmin, (req, res, next) => auth.setActive(req, res, next));
  app.patch("/api/users/:id/password", authenticated, requireAdmin, (req, res, next) => auth.resetPassword(req, res, next));
  app.delete("/api/users/:id", authenticated, requireAdmin, (req, res, next) => auth.softDelete(req, res, next));

  app.get("/api/license", authenticated, async (_req, res, next) => {
    try {
      res.json(await licenseStatus(db));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/license/activate", authenticated, requireAdmin, async (req, res, next) => {
    try {
      const result = await activateLicense(db, String(req.body.licenseKey || "").trim(), req.user);
      if (result.error) return res.status(400).json({ error: result.error });
      res.json(result.license);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", authenticated, async (_req, res, next) => {
    try {
      res.json(await getSettings(db));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/settings", authenticated, requireAdmin, activeLicense, async (req, res, next) => {
    try {
      res.json(await saveSettings(db, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settings/logo", authenticated, requireAdmin, activeLicense, async (req, res, next) => {
    try {
      const result = await saveLogo(db, req.body?.logoData);
      if (result.error) return res.status(400).json({ error: result.error });
      res.json(result.settings);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/settings/logo", authenticated, requireAdmin, activeLicense, async (_req, res, next) => {
    try {
      res.json(await removeLogo(db));
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", authenticated);

  app.get("/api/state", async (_req, res, next) => {
    try {
      res.json(await services.workspace.getWorkspace());
    } catch (error) {
      if (error.status !== 404) console.error("MongoDB load failed:", error);
      next(error.status === 404 ? error : new AppError("MongoDB is unavailable. Start MongoDB and check MONGODB_URI.", 503));
    }
  });

  app.put("/api/state", activeLicense, async (req, res, next) => {
    try {
      res.json(await services.workspace.saveWorkspace(req.body));
    } catch (error) {
      if (!(error instanceof AppError)) console.error("MongoDB save failed:", error);
      next(error instanceof AppError ? error : new AppError("The KPI workspace could not be saved to MongoDB.", 503));
    }
  });

  app.get("/api/refine", (_req, res) => {
    res.json(services.config.getRefinementStatus());
  });

  app.post("/api/refine", activeLicense, async (req, res, next) => {
    try {
      res.json(await services.refinement.refineAchievement(req.body || {}));
    } catch (error) {
      console.error("OpenAI refinement failed:", error);
      next(mapRefinementError(error));
    }
  });

  app.post("/api/import", activeLicense, upload.single("workbook"), async (req, res, next) => {
    try {
      res.json(await services.workbook.importKpis(req.file));
    } catch (error) {
      if (!(error instanceof AppError)) console.error("Workbook import failed:", error);
      next(error);
    }
  });

  app.post("/api/export", activeLicense, async (req, res, next) => {
    try {
      const workbook = await services.workbook.exportAppraisal(req.body || {});
      sendWorkbook(res, workbook);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/master/export", activeLicense, async (req, res, next) => {
    try {
      const workbook = await services.workbook.exportMaster(req.body || {});
      sendWorkbook(res, workbook);
    } catch (error) {
      next(error);
    }
  });

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distDir, "index.html"), (error) => {
      if (error) next(error);
    });
  });

  app.use(errorHandler);

  return app;
}

function sendWorkbook(res, { buffer, filename }) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

function mapRefinementError(error) {
  if (error instanceof AppError) return error;

  const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  const isTimeout = error?.name === "APIConnectionTimeoutError"
    || /timed out|timeout/i.test(error?.message || "");
  const isConnectionError = error?.name === "APIConnectionError"
    || /connection|fetch failed|network/i.test(error?.message || "");

  if (isTimeout || isConnectionError) {
    return new AppError("Cannot reach the OpenAI API. Allow outbound HTTPS access to api.openai.com on port 443, then try again.", 504);
  }
  if (status === 401) {
    return new AppError("The OpenAI API key was rejected. Check OPENAI_API_KEY in .env.", 401);
  }
  if (status === 429) {
    return new AppError("The OpenAI API project has no available quota or is being rate-limited. ChatGPT Plus does not cover API usage; check API billing, credits, and project limits.", 429);
  }
  return new AppError("The achievement could not be refined. Please try again.", status);
}

function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    return res.status(error.status).json({ error: error.message, ...error.details });
  }
  console.error(error);
  return res.status(500).json({ error: "Unexpected server error." });
}
