import test from "node:test";
import assert from "node:assert/strict";
import { buildRefinementPrompt, normalizeImportedRows } from "../backend/lib/kpi.js";

test("prompt preserves supplied KPI context and anti-fabrication rule", () => {
  const prompt = buildRefinementPrompt({
    title: "Reduce report turnaround time",
    category: "Operations",
    target: "2 days",
    achievement: "Automated the weekly report.",
    evidence: "Run log"
  });

  assert.match(prompt, /Reduce report turnaround time/);
  assert.match(prompt, /Never invent metrics/);
  assert.match(prompt, /Automated the weekly report/);
});

test("normalizes common workbook headers", () => {
  const result = normalizeImportedRows([
    {
      Perspective: "Customer",
      Objective: "Improve service",
      "Weight %": "25%",
      Achievements: "Resolved priority requests",
      Progress: "Completed"
    }
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Improve service");
  assert.equal(result[0].weight, 25);
  assert.equal(result[0].status, "complete");
});

test("normalizes tactical headers and Excel whitespace", () => {
  const result = normalizeImportedRows([
    {
      Category: " Service\tDelivery ",
      "KPI / Objective": "Improve\nweekly   reporting",
      "Tactical (Measure)": "Reports\twithin SLA\n\n\nValidated monthly",
      Weight: "20",
      "Self-Appraisal %": "80%"
    }
  ]);

  assert.equal(result[0].category, "Service Delivery");
  assert.equal(result[0].title, "Improve\nweekly reporting");
  assert.equal(result[0].measure, "Reports within SLA\n\nValidated monthly");
  assert.equal(result[0].target, "100%");
  assert.equal(result[0].selfAppraisal, 80);
});

test("cleans hidden characters and quoted Excel objectives", () => {
  const result = normalizeImportedRows([
    {
      "KPI / Objective": "\"Improve\u00a0reporting\u200b\nacross teams\"",
      Category: "Operations"
    }
  ]);

  assert.equal(result[0].title, "Improve reporting\nacross teams");
});

test("self-appraisal scores are capped at 200 percent", () => {
  const result = normalizeImportedRows([
    {
      "KPI / Objective": "Stretch delivery",
      "Self-Appraisal %": "250%"
    }
  ]);

  assert.equal(result[0].selfAppraisal, 200);
});

test("removes wrapping quotes and spaces from pasted Excel objectives", () => {
  const result = normalizeImportedRows([
    {
      "KPI / Objective": '  " Deliver reliable data and reporting services"  '
    }
  ]);

  assert.equal(result[0].title, "Deliver reliable data and reporting services");
});
