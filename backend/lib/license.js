import { licenseValidator } from "../src/license-validator.js";

const licenseCollectionName = "licenses";

export function readLicenseKey(licenseKey) {
  const result = licenseValidator.validateKey(licenseKey);
  if (!result.ok) return result;
  return result;
}

export async function licenseStatus(db) {
  const saved = await db.collection(licenseCollectionName).findOne(
    { key: "workspace" },
    { projection: { _id: 0, licenseKey: 0 } }
  );
  if (!saved?.license) return { status: "inactive", active: false };

  const result = licenseValidator.validateLicense(saved.license);
  const active = result.ok;
  return normalizeLicenseStatus({
    ...saved,
    license: result.ok ? result.license : saved.license,
    status: active ? "active" : result.code === "license_expired" ? "expired" : "inactive",
    active,
    code: result.ok ? undefined : result.code,
    error: result.ok ? undefined : result.error
  });
}

export async function activateLicense(db, licenseKey, user) {
  const result = readLicenseKey(licenseKey);
  if (result.error) return result;

  const license = result.license;
  const saved = {
    key: "workspace",
    status: "active",
    license,
    licenseKeyHash: result.licenseKeyHash,
    activatedAt: new Date(),
    activatedBy: user.username,
    updatedAt: new Date()
  };
  await db.collection(licenseCollectionName).updateOne({ key: "workspace" }, { $set: saved }, { upsert: true });
  return { license: await licenseStatus(db) };
}

export function requireActiveLicense(db) {
  return async (_req, res, next) => {
    try {
      const license = await licenseStatus(db);
      if (license.active) return next();
      res.status(402).json({
        error: "An active workspace licence is required. An administrator can activate a new key in Settings.",
        license
      });
    } catch (error) {
      next(error);
    }
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function normalizeLicenseStatus(saved) {
  const license = saved.license || {};
  return {
    key: saved.key,
    active: Boolean(saved.active),
    status: saved.status || "inactive",
    code: saved.code,
    error: saved.error,
    licenseId: cleanText(license.licenseId),
    organization: cleanText(license.organization) || "Unassigned workspace",
    organizationId: cleanText(license.organizationId),
    solutionId: cleanText(license.solutionId),
    solutionName: cleanText(license.solutionName),
    productCode: cleanText(license.productCode),
    appId: cleanText(license.appId),
    environment: cleanText(license.environment),
    audience: cleanText(license.audience),
    plan: cleanText(license.plan) || "Standard",
    features: Array.isArray(license.features) ? license.features : [],
    limits: license.limits && typeof license.limits === "object" ? license.limits : {},
    issuedAt: license.issuedAt || null,
    startsAt: license.startsAt || null,
    expiresAt: license.expiresAt || null,
    activatedAt: saved.activatedAt,
    activatedBy: saved.activatedBy,
    updatedAt: saved.updatedAt
  };
}
