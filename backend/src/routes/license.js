import express from "express";
import { licenseValidator } from "../license-validator.js";
import {
  getActivatedLicense,
  saveActivatedLicense,
} from "../services/license-store.js";

export const licenseRouter = express.Router();

licenseRouter.post("/activate", async (req, res) => {
  const { licenseKey } = req.body;
  const result = licenseValidator.validateKey(licenseKey);

  if (!result.ok) {
    return res.status(400).json({
      ok: false,
      code: result.code,
      error: result.error,
      details: result.details,
    });
  }

  await saveActivatedLicense({
    license: result.license,
    licenseKey: result.licenseKey,
    licenseKeyHash: result.licenseKeyHash,
  });

  return res.json({
    ok: true,
    license: {
      licenseId: result.license.licenseId,
      organization: result.license.organization,
      plan: result.license.plan,
      features: result.license.features,
      limits: result.license.limits,
      startsAt: result.license.startsAt,
      expiresAt: result.license.expiresAt,
    },
  });
});

licenseRouter.get("/status", async (req, res) => {
  const activated = await getActivatedLicense();

  if (!activated?.license) {
    return res.json({
      ok: true,
      active: false,
      license: null,
    });
  }

  const result = licenseValidator.validateLicense(activated.license);

  if (!result.ok) {
    return res.json({
      ok: true,
      active: false,
      code: result.code,
      error: result.error,
      license: {
        licenseId: activated.license.licenseId,
        organization: activated.license.organization,
        plan: activated.license.plan,
        expiresAt: activated.license.expiresAt,
      },
    });
  }

  return res.json({
    ok: true,
    active: true,
    license: {
      licenseId: result.license.licenseId,
      organization: result.license.organization,
      plan: result.license.plan,
      features: result.license.features,
      limits: result.license.limits,
      startsAt: result.license.startsAt,
      expiresAt: result.license.expiresAt,
    },
  });
});