import crypto from "node:crypto";

const licenseCollectionName = "licenses";
const appName = "KPI Appraisal Assistant";

function configuredPublicKey() {
  const raw = process.env.LICENSE_PUBLIC_KEY?.trim();
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export function readLicenseKey(licenseKey) {
  const publicKey = configuredPublicKey();
  if (!publicKey) return { error: "LICENSE_PUBLIC_KEY is not configured on the server." };

  const [payload, signature, ...extra] = String(licenseKey || "").trim().split(".");
  if (!payload || !signature || extra.length) return { error: `This licence key is invalid or was not issued for ${appName}.` };

  try {
    const valid = crypto.verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64url"));
    if (!valid) return { error: `This licence key is invalid or was not issued for ${appName}.` };
    const license = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (license?.version !== 1 || typeof license.expiresAt !== "string") {
      return { error: `This licence key is invalid or was not issued for ${appName}.` };
    }
    return { license };
  } catch {
    return { error: `This licence key is invalid or was not issued for ${appName}.` };
  }
}

export async function licenseStatus(db) {
  const license = await db.collection(licenseCollectionName).findOne(
    { key: "workspace" },
    { projection: { _id: 0, licenseKey: 0 } }
  );
  if (!license) return { status: "inactive", active: false };
  const active = license.status === "active"
    && Number.isFinite(Date.parse(license.expiresAt))
    && new Date(license.expiresAt) > new Date();
  return { ...license, status: active ? "active" : "expired", active };
}

export async function activateLicense(db, licenseKey, user) {
  const result = readLicenseKey(licenseKey);
  if (result.error) return result;

  const license = result.license;
  if (!Number.isFinite(Date.parse(license.expiresAt)) || new Date(license.expiresAt) <= new Date()) {
    return { error: "This licence key has already expired. Request a new key." };
  }

  const saved = {
    key: "workspace",
    licenseKey,
    status: "active",
    organization: cleanText(license.organization) || "Unassigned workspace",
    plan: cleanText(license.plan) || "Standard",
    issuedAt: license.issuedAt || null,
    expiresAt: license.expiresAt,
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
