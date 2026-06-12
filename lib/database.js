import { MongoClient } from "mongodb";

let client;
let database;

export async function getDatabase() {
  if (database) return database;

  const uri = process.env.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017";
  const databaseName = process.env.MONGODB_DB?.trim() || "kpi_appraisal";
  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000
  });
  await client.connect();
  database = client.db(databaseName);
  return database;
}

export async function getWorkspace(workspaceId = "default") {
  const db = await getDatabase();
  return db.collection("workspaces").findOne(
    { workspaceId },
    { projection: { _id: 0 } }
  );
}

export async function saveWorkspace(state, workspaceId = "default") {
  const db = await getDatabase();
  const now = new Date();
  await db.collection("workspaces").updateOne(
    { workspaceId },
    {
      $set: { workspaceId, state, updatedAt: now },
      $setOnInsert: { createdAt: now }
    },
    { upsert: true }
  );
  return { workspaceId, updatedAt: now };
}

export async function databaseStatus() {
  try {
    const db = await getDatabase();
    await db.command({ ping: 1 });
    return { connected: true, database: db.databaseName };
  } catch (error) {
    database = undefined;
    if (client) await client.close().catch(() => {});
    client = undefined;
    return { connected: false, error: error.message };
  }
}

export async function closeDatabase() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}
