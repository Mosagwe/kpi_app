const settingsCollectionName = "settings";

export async function initializeSettings(db) {
  await db.collection(settingsCollectionName).updateOne(
    { key: "workspace" },
    {
      $setOnInsert: {
        key: "workspace",
        name: "KPI Appraisal Assistant",
        logoMode: "default",
        timezone: "Africa/Nairobi",
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
}

export async function getSettings(db) {
  return db.collection(settingsCollectionName).findOne(
    { key: "workspace" },
    { projection: { _id: 0, key: 0 } }
  );
}

export async function saveSettings(db, payload) {
  const settings = {
    name: cleanText(payload.name) || "KPI Appraisal Assistant",
    timezone: cleanText(payload.timezone) || "Africa/Nairobi",
    updatedAt: new Date()
  };
  await db.collection(settingsCollectionName).updateOne({ key: "workspace" }, { $set: settings }, { upsert: true });
  return getSettings(db);
}

export async function saveLogo(db, logoData) {
  const value = String(logoData || "");
  if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(value) || value.length > 1_400_000) {
    return { error: "Upload a PNG, JPEG, WebP, or SVG logo smaller than 1 MB." };
  }
  await db.collection(settingsCollectionName).updateOne(
    { key: "workspace" },
    { $set: { logoData: value, logoMode: "custom", updatedAt: new Date() } },
    { upsert: true }
  );
  return { settings: await getSettings(db) };
}

export async function removeLogo(db) {
  await db.collection(settingsCollectionName).updateOne(
    { key: "workspace" },
    { $set: { logoMode: "none", updatedAt: new Date() }, $unset: { logoData: "" } },
    { upsert: true }
  );
  return getSettings(db);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}
