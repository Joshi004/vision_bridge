import fs from "fs";
import path from "path";
import { getLogsDir, getHtmlLogsDir } from "./paths.js";

type Level = "INFO" | "DEBUG" | "ERROR";

let logFilePath: string | null = null;
let logStream: fs.WriteStream | null = null;
let runLabel: string = "";
let logForwarder: ((level: Level, component: string, message: string, timestamp: string) => void) | null = null;

/**
 * Register a callback that receives every log entry as it is written.
 * Used by the IPC layer to stream real-time log entries to the renderer.
 */
export function setLogForwarder(fn: (level: Level, component: string, message: string, timestamp: string) => void): void {
  logForwarder = fn;
}

/** Remove the previously registered log forwarder. */
export function clearLogForwarder(): void {
  logForwarder = null;
}

/**
 * Call once before scraping begins. Creates the logs/ and logs/html/
 * directories and opens the per-run log file.
 */
export function init(): void {
  const htmlDir = getHtmlLogsDir();
  fs.mkdirSync(htmlDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  runLabel = ts;
  logFilePath = path.join(getLogsDir(), `scrape-${ts}.log`);
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  _write("INFO", "logger", `Log file opened: ${logFilePath}`);
}

/** Absolute path to the current run's log file, or null if not initialised. */
export function getLogFilePath(): string | null {
  return logFilePath;
}

/** Absolute path to the logs directory. */
export function getLogsDirPath(): string {
  return getLogsDir();
}

export function info(component: string, message: string): void {
  _write("INFO", component, message);
}

export function debug(component: string, message: string): void {
  _write("DEBUG", component, message);
}

export function error(component: string, message: string): void {
  _write("ERROR", component, message);
}

/**
 * Writes an HTML string to logs/html/<component>-<label>-<ts>.html
 * and logs the saved path. Returns the saved file path.
 */
export function dumpHtml(component: string, label: string, html: string): string {
  const ts = Date.now();
  const filename = `${component}-${label}-${ts}.html`;
  const filePath = path.join(getHtmlLogsDir(), filename);
  try {
    fs.writeFileSync(filePath, html, "utf-8");
    _write("DEBUG", component, `HTML dump saved → logs/html/${filename}`);
  } catch (err) {
    _write("ERROR", component, `Failed to write HTML dump: ${String(err)}`);
  }
  return filePath;
}

/**
 * Saves a screenshot buffer to logs/<component>-<label>-<ts>.png
 * and logs the saved path. Returns the saved file path.
 */
export function saveScreenshot(component: string, label: string, buffer: Buffer): string {
  const ts = Date.now();
  const filename = `${component}-${label}-${ts}.png`;
  const filePath = path.join(getLogsDir(), filename);
  try {
    fs.writeFileSync(filePath, buffer);
    _write("DEBUG", component, `Screenshot saved → logs/${filename}`);
  } catch (err) {
    _write("ERROR", component, `Failed to write screenshot: ${String(err)}`);
  }
  return filePath;
}

function _write(level: Level, component: string, message: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.padEnd(5)}] [${component}] ${message}`;

  // Always mirror to stderr so terminal output is preserved.
  process.stderr.write(line + "\n");

  if (logStream) {
    logStream.write(line + "\n");
  }

  if (logForwarder) {
    try {
      logForwarder(level, component, message, ts);
    } catch {
      // Never let the forwarder crash the logger.
    }
  }
}
