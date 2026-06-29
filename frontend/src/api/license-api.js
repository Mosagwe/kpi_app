import { fetchJson } from "./client.js";

export const getLicenseStatus = async () => {
  return normalizeLicenseStatus(await fetchJson("/api/license"));
};

export const activateLicense = async (licenseKey) => {
  return normalizeLicenseStatus(await fetchJson("/api/license/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseKey }),
  }));
};

function normalizeLicenseStatus(data) {
  const license = data?.license || data;
  return {
    ...license,
    active: Boolean(data?.active ?? license?.active),
    status: data?.status || license?.status || (data?.active || license?.active ? "active" : "inactive")
  };
}
