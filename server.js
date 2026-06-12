import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI from "openai";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { buildRefinementPrompt, normalizeImportedRows } from "./lib/kpi.js";
import {
  closeDatabase,
  databaseStatus,
  getWorkspace,
  saveWorkspace
} from "./lib/database.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json({ limit: "2mb" }));
app.get("/vendor/redux.mjs", (_req, res) => {
  res.sendFile("node_modules/redux/dist/redux.browser.mjs", { root: process.cwd() });
});
app.use(express.static("public"));

app.get("/api/config", (_req, res) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const proxy = getProxyConfig();
  res.json({
    aiConfigured: Boolean(apiKey && !apiKey.includes("your_api_key")),
    model: process.env.OPENAI_MODEL || "gpt-5.5",
    proxyConfigured: Boolean(proxy.url),
    proxyError: proxy.error
  });
});

app.get("/api/database/status", async (_req, res) => {
  const status = await databaseStatus();
  res.status(status.connected ? 200 : 503).json(status);
});

app.get("/api/state", async (_req, res) => {
  try {
    const workspace = await getWorkspace();
    if (!workspace) {
      return res.status(404).json({ error: "No MongoDB workspace exists yet." });
    }
    res.json({
      state: workspace.state,
      updatedAt: workspace.updatedAt
    });
  } catch (error) {
    console.error("MongoDB load failed:", error);
    res.status(503).json({
      error: "MongoDB is unavailable. Start MongoDB and check MONGODB_URI."
    });
  }
});

app.put("/api/state", async (req, res) => {
  const state = req.body;
  if (!state || typeof state !== "object" || !Array.isArray(state.quarters)
      || (!state.mastersByYear && !Array.isArray(state.masterKpis))) {
    return res.status(400).json({ error: "The KPI workspace data is invalid." });
  }
  try {
    const result = await saveWorkspace(state);
    res.json(result);
  } catch (error) {
    console.error("MongoDB save failed:", error);
    res.status(503).json({
      error: "The KPI workspace could not be saved to MongoDB."
    });
  }
});

app.get("/api/refine", (_req, res) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const proxy = getProxyConfig();
  res.json({
    ready: Boolean(apiKey && !apiKey.includes("your_api_key")),
    method: "POST",
    proxyConfigured: Boolean(proxy.url),
    proxyError: proxy.error,
    message: "AI refinement is ready. Use the Refine with AI button inside a quarterly KPI."
  });
});

app.post("/api/refine", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey.includes("your_api_key")) {
    return res.status(503).json({
      error: "OpenAI is not configured. Add OPENAI_API_KEY to the .env file and restart the app."
    });
  }

  const { kpi, tone, instruction } = req.body || {};
  if (!kpi?.title || !kpi?.achievement?.trim()) {
    return res.status(400).json({ error: "Add an achievement draft before refining it." });
  }

  try {
    const proxy = getProxyConfig();
    if (proxy.error) {
      return res.status(500).json({ error: proxy.error });
    }
    const clientOptions = { apiKey, timeout: 30000, maxRetries: 1 };
    if (proxy.url) {
      clientOptions.fetch = undiciFetch;
      clientOptions.fetchOptions = { dispatcher: new ProxyAgent(proxy.url) };
    }
    const client = new OpenAI(clientOptions);
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      input: buildRefinementPrompt(kpi, { tone, instruction })
    });

    const refined = response.output_text?.trim();
    if (!refined) throw new Error("The model returned an empty response.");
    res.json({ refined });
  } catch (error) {
    console.error("OpenAI refinement failed:", error);
    const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
    const isTimeout = error?.name === "APIConnectionTimeoutError"
      || /timed out|timeout/i.test(error?.message || "");
    const isConnectionError = error?.name === "APIConnectionError"
      || /connection|fetch failed|network/i.test(error?.message || "");

    if (isTimeout || isConnectionError) {
      return res.status(504).json({
        error: "Cannot reach the OpenAI API. Allow outbound HTTPS access to api.openai.com on port 443, then try again."
      });
    }
    res.status(status).json({
      error: status === 401
        ? "The OpenAI API key was rejected. Check OPENAI_API_KEY in .env."
        : status === 429
          ? "The OpenAI account has no available quota or is being rate-limited. Check API billing and usage."
        : "The achievement could not be refined. Please try again."
    });
  }
});

function getProxyConfig() {
  const raw = process.env.OPENAI_PROXY_URL?.trim()
    || process.env.HTTPS_PROXY?.trim()
    || process.env.HTTP_PROXY?.trim()
    || "";
  if (!raw) return { url: "", error: "" };
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported protocol");
    return { url: raw, error: "" };
  } catch {
    return {
      url: "",
      error: "The proxy setting is invalid. Use a complete URL such as http://proxy.company.com:8080."
    };
  }
}

app.post("/api/import", upload.single("workbook"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a workbook to import." });

  try {
    const workbook = new ExcelJS.Workbook();
    if (req.file.originalname.toLowerCase().endsWith(".csv")) {
      await workbook.csv.read(Readable.from(req.file.buffer));
    } else {
      await workbook.xlsx.load(req.file.buffer);
    }
    const candidates = workbook.worksheets.map((sheet) => ({
      sheetName: sheet.name,
      kpis: normalizeImportedRows(worksheetToObjects(sheet))
    }));
    const best = candidates.sort((a, b) => b.kpis.length - a.kpis.length)[0];

    if (!best?.kpis.length) {
      return res.status(422).json({
        error: "No KPI rows were found. Include a column named KPI, Objective, Goal or Title."
      });
    }
    res.json({ sheetName: best.sheetName, kpis: best.kpis });
  } catch (error) {
    console.error("Workbook import failed:", error);
    res.status(422).json({
      error: "This workbook could not be read. If it is password-protected or organization-encrypted, open it in Excel and save an unencrypted .xlsx copy first."
    });
  }
});

app.post("/api/export", async (req, res) => {
  const { profile = {}, kpis = [] } = req.body || {};
  if (!Array.isArray(kpis) || !kpis.length) {
    return res.status(400).json({ error: "There are no KPIs to export." });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KPI Appraisal Assistant";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("KPI Appraisal", {
    views: [{ state: "frozen", ySplit: 9 }]
  });
  const summaryRows = [
    ["KPI APPRAISAL"],
    [],
    ["Employee", profile.employee || ""],
    ["Role", profile.role || ""],
    ["Department", profile.department || ""],
    ["Review period", profile.period || ""],
    ["Manager", profile.manager || ""],
    [],
    ["Category", "KPI / Objective", "Tactical (Measure)", "Total Weight", "Achievement", "Supporting Evidence", "Self Appraisal", "Total Score", "Status"],
    ...kpis.map((kpi) => [
      kpi.category,
      kpi.title,
      kpi.measure,
      Number(kpi.weight) || 0,
      kpi.achievement,
      kpi.evidence,
      Number(kpi.selfAppraisal) || 0,
      ((Number(kpi.weight) || 0) * (Number(kpi.selfAppraisal) || 0)) / 100,
      displayStatus(kpi.status)
    ])
  ];
  summaryRows.forEach((row) => sheet.addRow(row));
  sheet.columns = [
    { width: 22 }, { width: 38 }, { width: 34 }, { width: 14 }, { width: 65 },
    { width: 42 }, { width: 18 }, { width: 16 }, { width: 16 }
  ];
  sheet.mergeCells("A1:I1");
  sheet.getCell("A1").font = { name: "Arial", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F36" } };
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.getRow(1).height = 32;
  sheet.getRow(9).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24584C" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  for (let row = 10; row <= 9 + kpis.length; row += 1) {
    sheet.getRow(row).alignment = { vertical: "top", wrapText: true };
    sheet.getCell(`H${row}`).value = {
      formula: `D${row}*G${row}/100`,
      result: ((Number(kpis[row - 10].weight) || 0) * (Number(kpis[row - 10].selfAppraisal) || 0)) / 100
    };
    sheet.getCell(`H${row}`).numFmt = '0.00"%"';
  }
  sheet.autoFilter = { from: "A9", to: `I${9 + kpis.length}` };

  const buffer = await workbook.xlsx.writeBuffer();
  const safeName = (profile.employee || "employee").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName || "employee"}-kpi-appraisal.xlsx"`);
  res.send(buffer);
});

function worksheetToObjects(sheet) {
  const populatedRows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    populatedRows.push(row.values.slice(1).map(cellText));
  });
  if (populatedRows.length < 2) return [];

  const headerIndex = populatedRows.findIndex((row) =>
    row.some((value) =>
      ["kpi", "kpi / objective", "objective", "goal", "title", "key performance indicator"].includes(value.toLowerCase())
    )
  );
  if (headerIndex === -1) return [];
  const headers = populatedRows[headerIndex];
  return populatedRows.slice(headerIndex + 1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header || `Column ${index + 1}`, values[index] || ""]))
  );
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value) return String(value.text);
    if ("result" in value) return String(value.result ?? "");
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  }
  return String(value).trim();
}

function displayStatus(status) {
  if (status === "complete") return "Complete";
  if (status === "in-progress") return "In progress";
  return "Not started";
}

app.listen(port, () => {
  console.log(`KPI Appraisal Assistant running at http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await closeDatabase().catch(() => {});
    process.exit(0);
  });
}
