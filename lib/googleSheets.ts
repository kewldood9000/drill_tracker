import { db, getGoogleSheetsConnection, saveGoogleSheetsConnection } from "./db";
import type { Course, CourseAttemptSheetMapping, GoogleSheetField, GoogleSheetMapping, GoogleSheetsConnection, Run } from "./types";
import { calculateHitFactor, evaluatePassCriteria, hasPassCriteria } from "./scoring";

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
    let settled = false; const finish = (error?: Error) => { if (settled) return; settled = true; window.clearTimeout(timeout); error ? reject(error) : resolve(); }; const timeout = window.setTimeout(() => finish(new Error("Google sign-in did not load. Open the app in Safari and try again.")), 12000);
    if (existing) { const checkReady = () => { if (window.google?.accounts?.oauth2) finish(); }; existing.addEventListener("load", checkReady, { once: true }); existing.addEventListener("error", () => finish(new Error("Google sign-in could not load.")), { once: true }); checkReady(); return; }
    const script = document.createElement("script"); script.src = scriptUrl; script.async = true; script.defer = true; script.onload = () => window.google?.accounts?.oauth2 ? finish() : finish(new Error("Google sign-in could not start.")); script.onerror = () => finish(new Error("Google sign-in could not load.")); document.head.appendChild(script);
  });
  try { await scriptPromise; } catch (error) { scriptPromise = undefined; throw error; }
}

async function requestGoogleToken(prompt: string) {
  if (!clientId) throw new Error("Google sign-in has not been configured for this site yet.");
  await loadGoogleScript();
  return await new Promise<string>((resolve, reject) => {
    let settled = false; const finish = (token?: string, error?: Error) => { if (settled) return; settled = true; window.clearTimeout(timeout); token ? resolve(token) : reject(error ?? new Error("Google sign-in was cancelled.")); }; const timeout = window.setTimeout(() => finish(undefined, new Error("Google sign-in did not open. Open the app in Safari and try again.")), 15000);
    const tokenClient = window.google?.accounts?.oauth2?.initTokenClient({ client_id: clientId, scope: sheetsScope, callback: response => {
      if (!response.access_token) { finish(undefined, new Error(response.error || "Google sign-in was cancelled.")); return; }
      accessToken = response.access_token; finish(accessToken);
    }});
    if (!tokenClient) { finish(undefined, new Error("Google sign-in is unavailable.")); return; }
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
const headers = ["Recorded at", "Time (sec)", "Drill", "Course", "Alpha", "Charlie", "Delta", "Miss", "Points", "Hit Factor", "Standard", "Run ID", "Non-Alpha hits"];
const defaultColumns: Record<GoogleSheetField, string> = { recordedAt: "A", time: "B", drill: "C", course: "D", alpha: "E", charlie: "F", delta: "G", miss: "H", nonAlpha: "M", points: "I", hitFactor: "J", standard: "K", result: "", runId: "L" };
const customMappingActive = (mapping?: GoogleSheetMapping) => Boolean(mapping?.sheetName.trim() && Object.values(mapping.columns).some(Boolean));

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
  const firstRow = await api(`spreadsheets/${connection.spreadsheetId}/values/${range(connection.sheetName, "A1:M1")}`) as { values?: string[][] };
  if (firstRow.values?.[0]?.[0]) return;
  await api(`spreadsheets/${connection.spreadsheetId}/values/${range(connection.sheetName, "A1:M1")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [headers] }) });
}

async function prepareGoogleSheet(spreadsheetUrl: string, mapping?: GoogleSheetMapping) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  let sheetName = mapping?.sheetName.trim();
  if (customMappingActive(mapping)) { const metadata = await api(`spreadsheets/${spreadsheetId}?fields=sheets.properties`) as { sheets?: { properties?: { title?: string } }[] }; if (!metadata.sheets?.some(sheet => sheet.properties?.title === sheetName)) throw new Error(`The tab named ${sheetName} was not found in that spreadsheet.`); } else sheetName = await ensureTrackerTab(spreadsheetId);
  const now = new Date().toISOString();
  const connection: GoogleSheetsConnection = { spreadsheetId, spreadsheetUrl: spreadsheetUrl.trim(), sheetName: sheetName || "Drill Tracker", mapping, connectedEmail: await signedInEmail(), createdAt: now, updatedAt: now };
  if (!customMappingActive(mapping)) await ensureHeaders(connection);
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

const runValues = (run: Run): Record<GoogleSheetField, string | number> => ({ recordedAt: new Date(run.timestamp).toLocaleString(), time: run.time, drill: run.drillNameAtTime, course: run.courseNameAtTime || "", alpha: run.alpha, charlie: run.charlie, delta: run.delta, miss: run.miss, nonAlpha: run.charlie + run.delta + run.miss, points: run.points, hitFactor: run.hitFactor, standard: run.achievedStandardName || "", result: run.passed === undefined ? "" : run.passed ? "PASS" : "FAIL", runId: run.id });
const columnIndex = (column: string) => [...column.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
const columnName = (index: number) => { let value = index + 1; let output = ""; while (value) { const remainder = (value - 1) % 26; output = String.fromCharCode(65 + remainder) + output; value = Math.floor((value - 1) / 26); } return output; };
const validColumns = (columns: Partial<Record<GoogleSheetField, string>>) => (Object.entries(columns) as [GoogleSheetField, string][]).filter(([, column]) => /^[A-Z]{1,3}$/i.test(column));
const mappedRow = (run: Run, mapping?: GoogleSheetMapping) => { const columns = customMappingActive(mapping) ? mapping?.columns ?? {} : defaultColumns; const entries = validColumns(columns); const max = Math.max(...entries.map(([, column]) => columnIndex(column)), 0); const row = Array(max + 1).fill(""); const values = runValues(run); const cells = entries.map(([field, column]) => ({ column, value: values[field] })); cells.forEach(cell => { row[columnIndex(cell.column)] = cell.value; }); return { cells, row, endColumn: columnName(max) }; };
const rowPlacement = (mapping?: { startRow?: number; rowSpacing?: number }) => {
  const startRow = Math.floor(Number(mapping?.startRow));
  if (!Number.isFinite(startRow) || startRow < 1) return undefined;
  const rowSpacing = Math.max(1, Math.floor(Number(mapping?.rowSpacing) || 1));
  return { startRow, rowSpacing };
};
async function findAvailableRow(connection: GoogleSheetsConnection, startRow: number, rowSpacing: number, endColumn: string, reservedRows: number[] = []) {
  const lastRow = startRow + rowSpacing * 499;
  const reserved = new Set(reservedRows);
  const response = await api(`spreadsheets/${connection.spreadsheetId}/values/${range(connection.sheetName, `A${startRow}:${endColumn}${lastRow}`)}`) as { values?: string[][] };
  for (let rowNumber = startRow; rowNumber <= lastRow; rowNumber += rowSpacing) {
    if (reserved.has(rowNumber)) continue;
    const values = response.values?.[rowNumber - startRow];
    if (!values?.some(value => String(value).trim())) return rowNumber;
  }
  throw new Error("No empty data row was found in the next 500 planned rows. Choose a later starting row or make room in the Sheet.");
}
async function writeCells(connection: GoogleSheetsConnection, cells: { column: string; value: string | number }[], rowNumber: number) {
  await api(`spreadsheets/${connection.spreadsheetId}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: cells.map(cell => ({ range: `'${connection.sheetName.replaceAll("'", "''")}'!${cell.column}${rowNumber}`, values: [[cell.value]] })) }) });
}

async function prepareCourseGoogleSheet(spreadsheetUrl: string, mapping: CourseAttemptSheetMapping) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl); const sheetName = mapping.sheetName.trim();
  if (!sheetName) throw new Error("Enter the Sheet tab for the one-row course export.");
  const metadata = await api(`spreadsheets/${spreadsheetId}?fields=sheets.properties`) as { sheets?: { properties?: { title?: string } }[] };
  if (!metadata.sheets?.some(sheet => sheet.properties?.title === sheetName)) throw new Error(`The tab named ${sheetName} was not found in that spreadsheet.`);
  const now = new Date().toISOString(); return { spreadsheetId, spreadsheetUrl: spreadsheetUrl.trim(), sheetName, connectedEmail: await signedInEmail(), createdAt: now, updatedAt: now } as GoogleSheetsConnection;
}

const courseAttemptValues = (course: Course, attemptId: string, runs: Run[]) => {
  const latest = course.entries.map(entry => runs.filter(run => run.courseEntryId === entry.id).reduce<Run | undefined>((current, run) => !current || run.timestamp > current.timestamp ? run : current, undefined)); const completed = latest.filter((run): run is Run => Boolean(run));
  const alpha = completed.reduce((sum, run) => sum + run.alpha, 0); const charlie = completed.reduce((sum, run) => sum + run.charlie, 0); const delta = completed.reduce((sum, run) => sum + run.delta, 0); const miss = completed.reduce((sum, run) => sum + run.miss, 0); const points = completed.reduce((sum, run) => sum + run.points, 0); const time = completed.reduce((sum, run) => sum + run.time, 0); const hitFactor = calculateHitFactor(points, time);
  const criteria = { ...course.passCriteria, maxNonAlpha: course.passCriteria?.maxNonAlpha ?? (course.passCriteria?.requireAllAlpha ? undefined : course.maxTotalNonAlpha), minPoints: course.passCriteria?.minPoints ?? course.minTotalPoints }; const limit = criteria.maxNonAlpha ?? (criteria.requireAllAlpha ? 0 : undefined); const earlyFail = limit !== undefined && charlie + delta + miss > limit || criteria.maxTime !== undefined && time > criteria.maxTime; const result = completed.length === course.entries.length ? evaluatePassCriteria(criteria, { time, alpha, charlie, delta, miss, points, hitFactor })?.passed : earlyFail ? false : undefined;
  const latestTimestamp = completed.reduce((latest, run) => !latest || run.timestamp > latest ? run.timestamp : latest, ""); return { latest, values: { recordedAt: latestTimestamp ? new Date(latestTimestamp).toLocaleString() : "", time, drill: "", course: course.name, alpha, charlie, delta, miss, nonAlpha: charlie + delta + miss, points, hitFactor: hitFactor ?? "", standard: "", result: result === undefined ? "" : result ? "PASS" : "FAIL", runId: attemptId } satisfies Record<GoogleSheetField, string | number> };
};

const attemptCells = (course: Course, attemptId: string, runs: Run[], mapping: CourseAttemptSheetMapping) => {
  const { latest, values } = courseAttemptValues(course, attemptId, runs); const cells = validColumns(mapping.columns).map(([field, column]) => ({ column, value: values[field] }));
  latest.forEach((run, index) => { const entryId = course.entries[index]?.id; if (!entryId || !run) return; validColumns(mapping.entryColumns[entryId] ?? {}).forEach(([field, column]) => cells.push({ column, value: runValues(run)[field] })); });
  if (!cells.length) throw new Error("Map at least one course or stage field before syncing this course.");
  const max = Math.max(...cells.map(cell => columnIndex(cell.column))); const row = Array(max + 1).fill(""); cells.forEach(cell => { row[columnIndex(cell.column)] = cell.value; }); return { cells, row, endColumn: columnName(max) };
};

const rowFromAppend = (updatedRange: string | undefined) => { const match = updatedRange?.match(/![A-Z]+(\d+):/); return match ? Number(match[1]) : undefined; };
async function syncCourseAttempt(course: Course, attemptId: string, mapping: CourseAttemptSheetMapping, destination: string, defaultConnection: GoogleSheetsConnection, pendingRuns: Run[]) {
  const attemptRuns = await db.runs.filter(run => run.courseId === course.id && run.courseAttemptId === attemptId).toArray(); const connection = destination === defaultConnection.spreadsheetUrl ? await prepareCourseGoogleSheet(destination, mapping) : await prepareCourseGoogleSheet(destination, mapping); const mapped = attemptCells(course, attemptId, attemptRuns, mapping); const existingRow = attemptRuns.find(run => run.courseSheetRow)?.courseSheetRow;
  let rowNumber = existingRow;
  if (rowNumber) await writeCells(connection, mapped.cells, rowNumber);
  else if (rowPlacement(mapping)) { const placement = rowPlacement(mapping)!; const reservedRows = (await db.runs.toArray()).map(run => run.courseSheetRow).filter((row): row is number => typeof row === "number"); rowNumber = await findAvailableRow(connection, placement.startRow, placement.rowSpacing, mapped.endColumn, reservedRows); await writeCells(connection, mapped.cells, rowNumber); }
  else { const response = await api(`spreadsheets/${connection.spreadsheetId}/values/${range(connection.sheetName, `A:${mapped.endColumn}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: [mapped.row] }) }) as { updates?: { updatedRange?: string } }; rowNumber = rowFromAppend(response.updates?.updatedRange); if (!rowNumber) throw new Error("Google Sheets did not return the new course row."); }
  const syncedAt = new Date().toISOString(); await db.runs.bulkPut(attemptRuns.map(run => ({ ...run, courseSheetRow: rowNumber, syncStatus: "synced" as const, syncedAt }))); return pendingRuns.length;
}

export async function syncGoogleSheets() {
  const defaultConnection = await getGoogleSheetsConnection();
  if (!defaultConnection) return { status: "not-connected" as const, count: 0 };
  if (!accessToken) return { status: "needs-sign-in" as const, count: 0 };
  const pending = await db.runs.filter(run => run.syncStatus !== "synced").toArray();
  if (!pending.length) return { status: "up-to-date" as const, count: 0 };
  const [drills, courses] = await Promise.all([db.drills.toArray(), db.courses.toArray()]); const drillById = new Map(drills.map(drill => [drill.id, drill])); const courseById = new Map(courses.map(course => [course.id, course]));
  const attempts = new Map<string, { course: Course; attemptId: string; mapping: CourseAttemptSheetMapping; destination: string; runs: Run[] }>(); const normalPending: Run[] = [];
  for (const run of pending) { const course = run.courseId ? courseById.get(run.courseId) : undefined; if (course?.courseAttemptSheetMapping && run.courseAttemptId) { const destination = course.googleSheetUrl?.trim() || defaultConnection.spreadsheetUrl; const key = `${course.id}|${run.courseAttemptId}`; const attempt = attempts.get(key) || { course, attemptId: run.courseAttemptId, mapping: course.courseAttemptSheetMapping, destination, runs: [] }; attempt.runs.push(run); attempts.set(key, attempt); } else normalPending.push(run); }
  let count = 0;
  for (const attempt of attempts.values()) count += await syncCourseAttempt(attempt.course, attempt.attemptId, attempt.mapping, attempt.destination, defaultConnection, attempt.runs);
  const groups = new Map<string, { destination: string; mapping?: GoogleSheetMapping; runs: Run[] }>();
  for (const run of normalPending) { const course = run.courseId ? courseById.get(run.courseId) : undefined; const drill = drillById.get(run.drillId); const destination = course?.googleSheetUrl?.trim() || drill?.googleSheetUrl?.trim() || defaultConnection.spreadsheetUrl; const mapping = course?.googleSheetMapping || drill?.googleSheetMapping || defaultConnection.mapping; const key = `${destination}|${JSON.stringify(mapping ?? {})}`; const group = groups.get(key) || { destination, mapping, runs: [] }; group.runs.push(run); groups.set(key, group); }
  for (const { destination, mapping, runs } of groups.values()) { const connection = destination === defaultConnection.spreadsheetUrl && mapping === defaultConnection.mapping ? defaultConnection : await prepareGoogleSheet(destination, mapping); const rows = runs.map(run => mappedRow(run, mapping)); const placement = rowPlacement(mapping); if (placement) { const syncedAt = new Date().toISOString(); const reservedRows = (await db.runs.toArray()).map(run => run.sheetRow).filter((row): row is number => typeof row === "number"); for (const run of runs) { const mapped = mappedRow(run, mapping); const rowNumber = run.sheetRow ?? await findAvailableRow(connection, placement.startRow, placement.rowSpacing, mapped.endColumn, reservedRows); reservedRows.push(rowNumber); await writeCells(connection, mapped.cells, rowNumber); await db.runs.put({ ...run, sheetRow: rowNumber, syncStatus: "synced", syncedAt }); } } else { const endColumn = rows.reduce((max, item) => Math.max(max, columnIndex(item.endColumn)), 0); await api(`spreadsheets/${connection.spreadsheetId}/values/${range(connection.sheetName, `A:${columnName(endColumn)}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: rows.map(item => item.row) }) }); const syncedAt = new Date().toISOString(); await db.runs.bulkPut(runs.map(run => ({ ...run, syncStatus: "synced" as const, syncedAt }))); } count += runs.length; }
  return { status: "synced" as const, count };
}
