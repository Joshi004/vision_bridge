import { join } from "path";

// Initialized to process.cwd() as a fallback for non-Electron environments.
// In production, electron/main.ts calls initPaths(app.getPath("userData"))
// before any backend module is used, so the real userData path is used.
let basePath: string = process.cwd();

export function initPaths(userDataPath: string): void {
  basePath = userDataPath;
}

export function getDbDir(): string {
  return join(basePath, "data");
}

export function getDbPath(): string {
  return join(basePath, "data", "vision.db");
}

export function getCookiesPath(): string {
  return join(basePath, "linkedin-session", "cookies.json");
}

export function getLogsDir(): string {
  return join(basePath, "logs");
}

export function getHtmlLogsDir(): string {
  return join(basePath, "logs", "html");
}
