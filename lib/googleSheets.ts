import { db, getGoogleSheetsConnection, saveGoogleSheetsConnection } from "./db";
import type { GoogleSheetsConnection, Run } from "./types";

type TokenResponse = { access_token?: string; error?: string };
type TokenClient = { requestAccessToken: (options?: { prompt?: string }) => void };
declare global { interface Window { google?: { accounts?: { oauth2?: { initTokenClient: (options: { client_id: string; scope: string; callback: (response: TokenResponse) => void }) => TokenClient } } } } }

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const scriptUrl = "https://accounts.google.com/gsi/client";
const sheetsScope = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email";
let accessToken = "";
let scriptPromise: Promise<void> | undefined;

export const googleSheetsConfigured = () => Boolean(clientId);
export const extractSpreadsheetId = (value: string) => {
  const match = value.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("Paste a valid Google Sheets share link.");
  return match[1];
};

async function loadGoogleScript() {
  if (window.google?.accounts?.oauth2) return;
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${scriptUrl}"]`) as HTMLScriptElement | null;
    if (existing) { existing.addEventListener("load", () => resolve(), { once: true }); existing.addEventListener("error", () => reject(new Error("Google sign-in could not load.")), { once: true }); return; }
    const script = document.createElement("script"); script.src = scriptUrl; script.async = true; script.defer = true; script.onload = () => resolve(); script.onerror = () => reject(new Error("Google sign-in could not load.")); document.head.appendChild(script);
  });
  await scriptPromise;
}

async function requestGoogleToken(prompt: string) {
  if (!clientId) throw new Error("Google sign-in has not been configured for this site yet.");
  await loadGoogleScript();
  return await new Promise<string>((resolve, reject) => {
    const tokenClient = window.google?.accounts?.oauth2?.initTokenClient({ client_id: clientId, scope: sheetsScope, callback: response => {
      if (!response.access_token) { reject(new Error(response.error || "Google sign-in was cancelled.")); return; }
      accessToken = response.access_token; resolve(accessToken);
    }});
    if (!tokenClient) { reject(new Error("Google sign-in is unavailable.")); return; }
    tokenClient.requestAccessToken({ prompt });
  });
}

async function api(path: string, init?: RequestInit) {
  if (!accessToken) throw new Error("Sign in with Google to sync your sheet.");
  const response = await fetch(`https://sheets.googleapis.com/v4/${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body?.error?.message || "Google Sheets could not complete that request."); }
  return response.status === 204 ? null : response.json();
}

const range = (sheetName: string, cells: string) => encodeURIComponent(`'${sheetName.replaceAll("'", "''")}'!${cells}`);
const headers = ["Recorded at", "Time (sec)", "Drill", "Course", "Alpha", "Charlie", "Delta", "Miss", "Points", "Hit Factor", "Standard", "Run ID"];

async function signedInEmail() {
  if (!accessToken) return "Google account";
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  const profile = await response.json().catch(() => ({}));
  return typeof profile.email === "string" ? profile.email : "Google account";
}

async function ensureTrackerTab(spreadsheetId: string) {
  const metadata = await api(`spreadsheets/${spreadsheetId}?fields=sheets.properties`) as { sheets?: { properties?: { title?: string } }[] };
  const existing = metadata.sheets?.find(sheet => sheet.properties?.title === "Drill Tracker")?.properties?.title;
  if (existing) return existing;
  await api(`spreadsheets/${spreadsheetId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "Drill Tracker" } } }] }) });
  return "Drill Tracker";
}

async function ensureHeaders(connection: GoogleSheetsConnection) {
  const firstRow = await api(`spreadsheets/${connection.spreadsheetId}/values/${range(connection.sheetName, "A1:L1")}`) as { values?: string[][] };
  if (firstRow.values?.[0]?.[0]) return;
  await api(`spreadsheets/${connection.spreadsheetId}/values/${range(connection.sheetName, "A1:L1")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [headers] }) });
}

async function prepareGoogleSheet(spreadsheetUrl: string) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  const sheetName = await ensureTrackerTab(spreadsheetId);
  const now = new Date().toISOString();
  const connection: GoogleSheetsConnection = { spreadsheetId, spreadsheetUrl: spreadsheetUrl.trim(), sheetName, connectedEmail: await signedInEmail(), createdAt: now, updatedAt: now };
  await ensureHeaders(connection);
  return connection;
}

export async function connectGoogleSheet(spreadsheetUrl: string) {
  await requestGoogleToken("consent");
  const connection = await prepareGoogleSheet(spreadsheetUrl);
  await saveGoogleSheetsConnection(connection);
  return connection;
}

export async function restoreGoogleSession() {
  if (!clientId || !await getGoogleSheetsConnection()) return false;
  try { await requestGoogleToken(""); return true; } catch { return false; }
}

const runRow = (run: Run) => [new Date(run.timestamp).toLocaleString(), run.time, run.drillNameAtTime, run.courseNameAtTime || "", run.alpha, run.charlie, run.delta, run.miss, run.points, run.hitFactor, run.achievedStandardName || "", run.id];

export async function syncGoogleSheets() {
  const defaultConnection = await getGoogleSheetsConnection();
  if (!defaultConnection) return { status: "not-connected" as const, count: 0 };
  if (!accessToken) return { status: "needs-sign-in" as const, count: 0 };
  const pending = await db.runs.filter(run => run.syncStatus !== "synced").toArray();
  if (!pending.length) return { status: "up-to-date" as const, count: 0 };
  const [drills, courses] = await Promise.all([db.drills.toArray(), db.courses.toArray()]);
  const drillById = new Map(drills.map(drill => [drill.id, drill])); const courseById = new Map(courses.map(course => [course.id, course]));
  const groups = new Map<string, Run[]>();
  for (const run of pending) { const course = run.courseId ? courseById.get(run.courseId) : undefined; const drill = drillById.get(run.drillId); const destination = course?.googleSheetUrl?.trim() || drill?.googleSheetUrl?.trim() || defaultConnection.spreadsheetUrl; groups.set(destination, [...(groups.get(destination) || []), run]); }
  let count = 0;
  for (const [destination, runs] of groups) {
    const connection = destination === defaultConnection.spreadsheetUrl ? defaultConnection : await prepareGoogleSheet(destination);
    await api(`spreadsheets/${connection.spreadsheetId}/values/${range(connection.sheetName, "A:L")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: runs.map(runRow) }) });
    const syncedAt = new Date().toISOString(); await db.runs.bulkPut(runs.map(run => ({ ...run, syncStatus: "synced" as const, syncedAt }))); count += runs.length;
  }
  return { status: "synced" as const, count };
}
