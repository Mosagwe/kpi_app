export const AUTH_TOKEN_KEY = "kpi.auth.token";

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

export function setAuthToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function getConfig() {
  return fetchJson("/api/config");
}

export async function login(payload) {
  const data = await fetchJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  setAuthToken(data.token);
  return data;
}

export async function register(payload) {
  return fetchJson("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function getCurrentUser() {
  return fetchJson("/api/auth/me");
}

export async function changePassword(payload) {
  return fetchJson("/api/auth/password", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function getLicense() {
  return fetchJson("/api/license");
}

export async function activateLicense(licenseKey) {
  return fetchJson("/api/license/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseKey })
  });
}

export async function getSettings() {
  return fetchJson("/api/settings");
}

export async function saveSettings(payload) {
  return fetchJson("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function saveLogo(logoData) {
  return fetchJson("/api/settings/logo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logoData })
  });
}

export async function deleteLogo() {
  return fetchJson("/api/settings/logo", { method: "DELETE" });
}

export async function getUsers() {
  return fetchJson("/api/users");
}

export async function createUser(payload) {
  return fetchJson("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function updateUserRole(id, role) {
  return fetchJson(`/api/users/${id}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role })
  });
}

export async function updateUserActive(id, active) {
  return fetchJson(`/api/users/${id}/active`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active })
  });
}

export async function resetUserPassword(id, newPassword) {
  return fetchJson(`/api/users/${id}/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword })
  });
}

export async function deleteUser(id) {
  return fetchJson(`/api/users/${id}`, { method: "DELETE" });
}

export async function getWorkspace() {
  const response = await fetchWithAuth("/api/state");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Workspace could not be loaded.");
    error.status = response.status;
    error.license = data.license;
    throw error;
  }
  return data;
}

export async function saveWorkspace(workspace) {
  return fetchJson("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workspace)
  });
}

export async function refineAchievement(payload) {
  return fetchJson("/api/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function importWorkbook(file) {
  const form = new FormData();
  form.append("workbook", file);
  return fetchJson("/api/import", { method: "POST", body: form });
}

export async function exportWorkbook(profile, kpis) {
  const response = await fetchWithAuth("/api/export", {
    method: "POST",
    headers: authedHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ profile, kpis })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Export failed.");
  }
  return response;
}

export async function exportMasterWorkbook(year, kpis) {
  const response = await fetchWithAuth("/api/master/export", {
    method: "POST",
    headers: authedHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ year, kpis })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Master KPI export failed.");
  }
  return response;
}

async function fetchJson(url, options) {
  const response = await fetchWithAuth(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.status = response.status;
    error.license = data.license;
    throw error;
  }
  return data;
}

function fetchWithAuth(url, options = {}) {
  return fetch(url, { ...options, headers: authedHeaders(options.headers) });
}

function authedHeaders(headers = {}) {
  const token = getAuthToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}
