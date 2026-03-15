import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseUrlList(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function isLinkedInProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "www.linkedin.com" || parsed.hostname === "linkedin.com") &&
      parsed.pathname.startsWith("/in/")
    );
  } catch {
    return false;
  }
}

function stageToRoute(stage: string): string {
  switch (stage.toLowerCase()) {
    case "draft": return "/drafts";
    case "contacted": return "/tracking";
    case "replied": return "/replies";
    case "converted":
    case "cold": return "/closed";
    default: return "/drafts";
  }
}

function stageLinkLabel(stage: string): string {
  switch (stage.toLowerCase()) {
    case "draft": return "Go to Drafts";
    case "contacted": return "Go to Tracking";
    case "replied": return "Go to Replies";
    case "converted": return "Go to Closed";
    case "cold": return "Go to Closed";
    default: return "Go to Drafts";
  }
}

function duplicateMessage(stage: string): string {
  switch (stage.toLowerCase()) {
    case "draft":
      return "This profile is already in your pipeline (Draft stage).";
    case "contacted":
      return "This profile has already been contacted (Contacted stage).";
    case "replied":
      return "This profile has replied to your outreach.";
    case "converted":
      return "This profile is already marked as Converted.";
    case "cold":
      return "This profile was previously contacted but went Cold. Would you like to reactivate it?";
    default:
      return "This profile is already in your pipeline.";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  level: "INFO" | "DEBUG" | "ERROR";
  component: string;
  message: string;
  timestamp: string;
}

interface UrlItemStatus {
  url: string;
  status: "pending" | "processing" | "done" | "skipped" | "error";
  profileName?: string | null;
  skippedStage?: string;
  error?: string;
}

type SinglePageState = "idle" | "loading" | "success" | "error";
type BulkRunState = "idle" | "running" | "done";
type Mode = "single" | "bulk";

// ─── Section A: Sender Configuration ─────────────────────────────────────────

function SenderConfigSection({ onSaved }: { onSaved?: () => void }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [fields, setFields] = useState<SenderConfig>({
    sender_name: "",
    company_name: "",
    company_description: "",
    sender_role: "",
    outreach_goal: "",
    message_tone: "",
    message_rules: "",
  });

  useEffect(() => {
    window.api.getSenderConfig().then((result) => {
      if ("success" in result && result.success) {
        setFields(result.config);
        if (result.config.company_name) {
          setIsExpanded(false);
        }
      }
    });
  }, []);

  function handleFieldChange(key: keyof SenderConfig, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const result = await window.api.saveSenderConfig(fields);
      if ("success" in result && result.success) {
        setFields(result.config);
      }
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        setIsExpanded(false);
        onSaved?.();
      }, 1500);
    } catch {
      // save failed silently — user can retry
    } finally {
      setIsSaving(false);
    }
  }

  const summaryName = fields.sender_name || "You";
  const summaryCompany = fields.company_name || "your company";

  return (
    <div className={`sender-config${isExpanded ? "" : " sender-config--collapsed"}`}>
      {isExpanded ? (
        <>
          <div className="sender-config__header">
            <span className="sender-config__header-title">Sender Configuration</span>
            {fields.company_name && (
              <button
                className="sender-config__toggle"
                onClick={() => setIsExpanded(false)}
              >
                Collapse
              </button>
            )}
          </div>

          <div className="sender-config__form">
            <div className="sender-config__row sender-config__row--two-col">
              <div className="sender-config__field">
                <label className="form-label">Your Name</label>
                <input
                  type="text"
                  className="sender-config__input"
                  placeholder="e.g. Naresh Joshi"
                  value={fields.sender_name}
                  onChange={(e) => handleFieldChange("sender_name", e.target.value)}
                />
              </div>
              <div className="sender-config__field">
                <label className="form-label">Company</label>
                <input
                  type="text"
                  className="sender-config__input"
                  placeholder="e.g. Techsergy"
                  value={fields.company_name}
                  onChange={(e) => handleFieldChange("company_name", e.target.value)}
                />
              </div>
            </div>

            <div className="sender-config__field">
              <label className="form-label">What You Do</label>
              <textarea
                className="sender-config__textarea"
                rows={3}
                placeholder="A software delivery company that supports startups and product teams…"
                value={fields.company_description}
                onChange={(e) => handleFieldChange("company_description", e.target.value)}
              />
            </div>

            <div className="sender-config__field">
              <label className="form-label">Your Role</label>
              <textarea
                className="sender-config__textarea"
                rows={2}
                placeholder="Senior technical lead. Delivery handled through my team…"
                value={fields.sender_role}
                onChange={(e) => handleFieldChange("sender_role", e.target.value)}
              />
            </div>

            <div className="sender-config__field">
              <label className="form-label">Outreach Goal</label>
              <textarea
                className="sender-config__textarea"
                rows={2}
                placeholder="Explore engineering collaboration opportunities…"
                value={fields.outreach_goal}
                onChange={(e) => handleFieldChange("outreach_goal", e.target.value)}
              />
            </div>

            <div className="sender-config__row sender-config__row--two-col">
              <div className="sender-config__field">
                <label className="form-label">Message Tone</label>
                <textarea
                  className="sender-config__textarea"
                  rows={2}
                  placeholder="Friendly and natural. Sound like a real human…"
                  value={fields.message_tone}
                  onChange={(e) => handleFieldChange("message_tone", e.target.value)}
                />
              </div>
              <div className="sender-config__field">
                <label className="form-label">Message Rules</label>
                <textarea
                  className="sender-config__textarea"
                  rows={2}
                  placeholder="No em dashes, no bullet points. Reference their profile genuinely…"
                  value={fields.message_rules}
                  onChange={(e) => handleFieldChange("message_rules", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="sender-config__footer">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : "Save Configuration"}
            </button>
            {saveSuccess && (
              <span className="sender-config__save-status">
                ✓ Saved
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="sender-config__summary">
          <span className="sender-config__summary-text">
            Sending as <strong>{summaryName}</strong> from <strong>{summaryCompany}</strong>
          </span>
          <button
            className="sender-config__toggle"
            onClick={() => setIsExpanded(true)}
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Section A½: Prompt Preview ──────────────────────────────────────────────

function PromptPreviewSection({ refreshKey }: { refreshKey: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isExpanded) return;
    setIsLoading(true);
    setError(null);
    window.api.getPromptPreview().then((result) => {
      if ("success" in result && result.success) {
        setPrompt(result.prompt);
      } else if ("error" in result) {
        setError(result.message);
      }
    }).finally(() => {
      setIsLoading(false);
    });
  }, [isExpanded, refreshKey]);

  return (
    <div className="prompt-preview">
      <button
        className="prompt-preview__toggle"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
      >
        <span className="prompt-preview__toggle-icon">{isExpanded ? "▾" : "▸"}</span>
        <span className="prompt-preview__toggle-label">Sample Prompt</span>
        <span className="prompt-preview__toggle-hint">
          Preview the prompt that will be sent to the model
        </span>
      </button>

      {isExpanded && (
        <div className="prompt-preview__body">
          {isLoading && (
            <div className="prompt-preview__loading">Loading prompt…</div>
          )}
          {error && (
            <div className="prompt-preview__error">{error}</div>
          )}
          {!isLoading && !error && prompt && (
            <pre className="prompt-preview__text">{prompt}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section B: Single Profile Mode ──────────────────────────────────────────

function SingleMode() {
  const [state, setState] = useState<SinglePageState>("idle");
  const [url, setUrl] = useState("");
  const [forceScrape, setForceScrape] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateCheckResult["lead"] | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [createdLeadName, setCreatedLeadName] = useState<string | null>(null);

  const logHandlerRef = useRef<ReturnType<typeof window.api.onScrapeLog> | null>(null);
  const pendingUrlRef = useRef<string | null>(null);
  const pendingForceRef = useRef<boolean>(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (state === "loading") {
      setLogEntries([]);
      const handler = window.api.onScrapeLog((entry) => {
        setLogEntries((prev) => [...prev, entry as LogEntry]);
      });
      logHandlerRef.current = handler;
    } else {
      if (logHandlerRef.current) {
        window.api.offScrapeLog(logHandlerRef.current);
        logHandlerRef.current = null;
      }
    }
  }, [state]);

  useEffect(() => {
    if (logsExpanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logEntries, logsExpanded]);

  async function processUrl(targetUrl: string, force: boolean) {
    setState("loading");
    setError(null);
    setDuplicateInfo(null);

    try {
      const dupCheck = await window.api.checkDuplicate(targetUrl);
      if (dupCheck.exists && dupCheck.lead) {
        setDuplicateInfo(dupCheck.lead);
        setState("idle");
        return;
      }

      const result = await window.api.createLeadFromScrape(targetUrl, force);

      if ("success" in result && result.success) {
        setCreatedLeadName(result.lead.name);
        setState("success");
        return;
      }

      if ("duplicate" in result && result.duplicate) {
        if (result.lead) {
          setDuplicateInfo(result.lead as DuplicateCheckResult["lead"] & { name: string; company: string });
        }
        setState("idle");
        return;
      }

      if ("message" in result) {
        if (result.needsLogin) {
          pendingUrlRef.current = targetUrl;
          pendingForceRef.current = force;
          setNeedsLogin(true);
          setState("idle");
          return;
        }
        setError(result.message);
        setState("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setState("error");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await processUrl(url.trim(), forceScrape);
  }

  async function handleLogin() {
    setNeedsLogin(false);
    setError(null);
    try {
      const result = await window.api.login();
      if ("error" in result) {
        setError(result.message);
        return;
      }
      const retryUrl = pendingUrlRef.current ?? url.trim();
      const retryForce = pendingForceRef.current;
      setUrl(retryUrl);
      await processUrl(retryUrl, retryForce);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed unexpectedly.");
    }
  }

  function handleReset() {
    setState("idle");
    setUrl("");
    setForceScrape(false);
    setError(null);
    setNeedsLogin(false);
    setDuplicateInfo(null);
    setLogEntries([]);
    setCreatedLeadName(null);
  }

  const isLoading = state === "loading";

  return (
    <>
      {error && (
        <div className="error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      {needsLogin && (
        <div className="login-prompt">
          <div className="login-prompt__text">
            <strong>LinkedIn login required.</strong> Your session is missing or has expired.
          </div>
          <button className="btn btn-login" onClick={handleLogin}>
            Login to LinkedIn
          </button>
        </div>
      )}

      {duplicateInfo && (
        <div className="duplicate-banner">
          <div className="duplicate-banner__message">
            {duplicateMessage(duplicateInfo.stage)}
          </div>
          {duplicateInfo.stage.toLowerCase() !== "converted" && (
            <Link to={stageToRoute(duplicateInfo.stage)} className="duplicate-banner__link">
              {stageLinkLabel(duplicateInfo.stage)} →
            </Link>
          )}
        </div>
      )}

      {state === "success" ? (
        <div className="success-banner">
          <span className="success-banner__icon">✓</span>
          <span className="success-banner__text">
            Lead{createdLeadName ? ` for ${createdLeadName}` : ""} created successfully.
          </span>
          <div className="success-banner__actions">
            <Link to="/drafts" className="btn btn-primary btn-sm">
              Go to Drafts to review
            </Link>
            <button className="btn btn-secondary btn-sm" onClick={handleReset}>
              Add Another
            </button>
          </div>
        </div>
      ) : (
        <form className="scrape-form" onSubmit={handleSubmit}>
          <label htmlFor="compose-url-input" className="form-label">
            LinkedIn Profile URL
          </label>
          <div className="input-row">
            <input
              id="compose-url-input"
              type="url"
              className="url-input"
              placeholder="https://www.linkedin.com/in/username/"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isLoading}
              required
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading || url.trim() === ""}
            >
              {isLoading ? "Processing…" : "Go"}
            </button>
          </div>
          <div className="force-scrape-row">
            <label className="force-scrape-label">
              <input
                type="checkbox"
                checked={forceScrape}
                onChange={(e) => setForceScrape(e.target.checked)}
                disabled={isLoading}
              />
              Force re-scrape
            </label>
            <span className="force-scrape-hint">
              {forceScrape
                ? "Will re-scrape LinkedIn even if cached data exists."
                : "Cached data (up to 3 days old) will be used if available."}
            </span>
          </div>
          {isLoading && (
            <p className="loading-hint">
              Scraping profile and generating outreach message — this may take 30–90 seconds.
            </p>
          )}
        </form>
      )}

      {(isLoading || (state !== "success" && logEntries.length > 0)) && (
        <div className="diag-log-panel">
          <button
            className="diag-log-toggle"
            onClick={() => setLogsExpanded((v) => !v)}
            aria-expanded={logsExpanded}
          >
            <span className="diag-log-toggle-icon">{logsExpanded ? "▾" : "▸"}</span>
            Diagnostic Logs
            <span className="diag-log-count">{logEntries.length}</span>
            {!isLoading && (
              <button
                className="btn-open-logs"
                onClick={(e) => { e.stopPropagation(); window.api.openLogsFolder(); }}
              >
                Open Logs Folder
              </button>
            )}
          </button>
          {logsExpanded && (
            <div className="diag-log-scroll">
              {logEntries.map((entry, i) => (
                <div key={i} className={`diag-log-line diag-log-${entry.level.toLowerCase()}`}>
                  <span className="diag-log-time">{entry.timestamp.slice(11, 23)}</span>
                  <span className="diag-log-level">{entry.level}</span>
                  <span className="diag-log-component">[{entry.component}]</span>
                  <span className="diag-log-msg">{entry.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─── Section C: Bulk Profile Mode ────────────────────────────────────────────

function BulkMode() {
  const navigate = useNavigate();
  const [bulkState, setBulkState] = useState<BulkRunState>("idle");
  const [rawUrls, setRawUrls] = useState("");
  const [forceScrape, setForceScrape] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [urlItems, setUrlItems] = useState<UrlItemStatus[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);

  const [summary, setSummary] = useState<{
    added: number;
    skipped: Array<{ name: string; stage: string; url: string }>;
    failed: Array<{ url: string; reason: string }>;
  } | null>(null);

  const cancelledRef = useRef(false);
  const logHandlerRef = useRef<ReturnType<typeof window.api.onScrapeLog> | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const urlListEndRef = useRef<HTMLDivElement | null>(null);

  const parsedUrls = parseUrlList(rawUrls);
  const validUrls = parsedUrls.filter(isLinkedInProfileUrl);
  const validCount = validUrls.length;
  const invalidCount = parsedUrls.filter((u) => !isLinkedInProfileUrl(u)).length;

  useEffect(() => {
    if (logsExpanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logEntries, logsExpanded]);

  useEffect(() => {
    if (urlListEndRef.current) {
      urlListEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [currentIndex]);

  async function handleStart() {
    setError(null);
    setNeedsLogin(false);
    setSummary(null);
    cancelledRef.current = false;

    const items: UrlItemStatus[] = validUrls.map((u) => ({ url: u, status: "pending" }));
    setUrlItems(items);
    setCurrentIndex(-1);
    setBulkState("running");

    setLogEntries([]);
    const logHandler = window.api.onScrapeLog((entry) => {
      setLogEntries((prev) => [...prev, entry as LogEntry]);
    });
    logHandlerRef.current = logHandler;

    const added: number[] = [];
    const skipped: Array<{ name: string; stage: string; url: string }> = [];
    const failed: Array<{ url: string; reason: string }> = [];

    for (let i = 0; i < validUrls.length; i++) {
      if (cancelledRef.current) break;

      const currentUrl = validUrls[i];
      setCurrentIndex(i);
      setUrlItems((prev) =>
        prev.map((item, idx) => idx === i ? { ...item, status: "processing" } : item)
      );

      try {
        const dupCheck = await window.api.checkDuplicate(currentUrl);
        if (dupCheck.exists && dupCheck.lead) {
          skipped.push({
            name: dupCheck.lead.name || currentUrl,
            stage: dupCheck.lead.stage,
            url: currentUrl,
          });
          setUrlItems((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: "skipped", skippedStage: dupCheck.lead!.stage } : item
            )
          );
          continue;
        }

        const result = await window.api.createLeadFromScrape(currentUrl, forceScrape);

        if ("success" in result && result.success) {
          added.push(i);
          setUrlItems((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: "done", profileName: result.lead.name } : item
            )
          );
        } else if ("duplicate" in result && result.duplicate) {
          const leadInfo = result.lead as { stage: string; name: string } | undefined;
          skipped.push({
            name: leadInfo?.name || currentUrl,
            stage: leadInfo?.stage || "unknown",
            url: currentUrl,
          });
          setUrlItems((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: "skipped", skippedStage: leadInfo?.stage } : item
            )
          );
        } else if ("message" in result) {
          if (result.needsLogin) {
            setNeedsLogin(true);
            setUrlItems((prev) =>
              prev.map((item, idx) =>
                idx === i ? { ...item, status: "error", error: "Login required" } : item
              )
            );
            failed.push({ url: currentUrl, reason: "Login required" });
            break;
          }
          failed.push({ url: currentUrl, reason: result.message });
          setUrlItems((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: "error", error: result.message } : item
            )
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unexpected error";
        failed.push({ url: currentUrl, reason: msg });
        setUrlItems((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: "error", error: msg } : item
          )
        );
      }
    }

    if (logHandlerRef.current) {
      window.api.offScrapeLog(logHandlerRef.current);
      logHandlerRef.current = null;
    }

    setSummary({ added: added.length, skipped, failed });
    setBulkState("done");
  }

  function handleCancel() {
    cancelledRef.current = true;
  }

  function handleReset() {
    setBulkState("idle");
    setRawUrls("");
    setForceScrape(false);
    setError(null);
    setNeedsLogin(false);
    setUrlItems([]);
    setCurrentIndex(-1);
    setSummary(null);
    setLogEntries([]);
    cancelledRef.current = false;
  }

  const completedCount = urlItems.filter(
    (i) => i.status === "done" || i.status === "error" || i.status === "skipped"
  ).length;

  return (
    <>
      {error && (
        <div className="error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      {needsLogin && (
        <div className="login-prompt">
          <div className="login-prompt__text">
            <strong>LinkedIn login required.</strong> Your session is missing or has expired.
          </div>
          <button className="btn btn-login" onClick={async () => {
            setNeedsLogin(false);
            setError(null);
            const result = await window.api.login();
            if ("error" in result) {
              setError(result.message);
            }
          }}>
            Login to LinkedIn
          </button>
        </div>
      )}

      {bulkState === "idle" && (
        <div className="bulk-form">
          <label className="form-label">LinkedIn Profile URLs (one per line)</label>
          <textarea
            className="bulk-textarea"
            placeholder={
              "https://www.linkedin.com/in/person-one/\nhttps://www.linkedin.com/in/person-two/\nhttps://www.linkedin.com/in/person-three/"
            }
            value={rawUrls}
            onChange={(e) => setRawUrls(e.target.value)}
            rows={8}
          />
          {parsedUrls.length > 0 && (
            <div className="bulk-url-stats">
              <span className="bulk-url-stat bulk-url-stat--valid">
                {validCount} valid URL{validCount !== 1 ? "s" : ""}
              </span>
              {invalidCount > 0 && (
                <span className="bulk-url-stat bulk-url-stat--invalid">
                  {invalidCount} invalid (will be skipped)
                </span>
              )}
            </div>
          )}
          <div className="force-scrape-row">
            <label className="force-scrape-label">
              <input
                type="checkbox"
                checked={forceScrape}
                onChange={(e) => setForceScrape(e.target.checked)}
              />
              Force re-scrape
            </label>
            <span className="force-scrape-hint">
              {forceScrape
                ? "Will re-scrape LinkedIn even if cached data exists."
                : "Cached data (up to 3 days old) will be used if available."}
            </span>
          </div>
          <div className="bulk-actions">
            <button
              className="btn btn-primary"
              disabled={validCount === 0}
              onClick={handleStart}
            >
              Process {validCount > 0 ? validCount : ""} URL{validCount !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      {(bulkState === "running" || bulkState === "done") && (
        <div className="bulk-progress-section">
          {bulkState === "running" && (
            <>
              <div className="bulk-progress-header">
                <div className="bulk-progress-label">
                  <span className="bulk-spinner" aria-hidden="true" />
                  Processing URLs — {completedCount} / {validCount} done
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
                  Cancel
                </button>
              </div>
              <div className="bulk-progress-bar-track">
                <div
                  className="bulk-progress-bar-fill"
                  style={{ width: validCount > 0 ? `${(completedCount / validCount) * 100}%` : "0%" }}
                />
              </div>
            </>
          )}

          <div className="bulk-url-list">
            {urlItems.map((item, i) => (
              <div key={i} className={`bulk-url-item bulk-url-item--${item.status}`}>
                <span className="bulk-url-icon" aria-hidden="true">
                  {item.status === "done" && "✓"}
                  {item.status === "skipped" && "⊘"}
                  {item.status === "error" && "✗"}
                  {item.status === "processing" && <span className="bulk-spinner-inline" />}
                  {item.status === "pending" && "·"}
                </span>
                <span className="bulk-url-text">
                  {item.profileName ? (
                    <>
                      <strong>{item.profileName}</strong>
                      <span className="bulk-url-sub">{item.url}</span>
                    </>
                  ) : item.status === "skipped" ? (
                    <>
                      <span>{item.url}</span>
                      {item.skippedStage && (
                        <span className="bulk-url-sub">Already in pipeline — {item.skippedStage}</span>
                      )}
                    </>
                  ) : (
                    item.url
                  )}
                </span>
                {item.status === "error" && item.error && (
                  <span className="bulk-url-error">{item.error}</span>
                )}
              </div>
            ))}
            <div ref={urlListEndRef} />
          </div>

          {(bulkState === "running" || logEntries.length > 0) && (
            <div className="diag-log-panel">
              <button
                className="diag-log-toggle"
                onClick={() => setLogsExpanded((v) => !v)}
                aria-expanded={logsExpanded}
              >
                <span className="diag-log-toggle-icon">{logsExpanded ? "▾" : "▸"}</span>
                Diagnostic Logs
                <span className="diag-log-count">{logEntries.length}</span>
                {bulkState !== "running" && (
                  <button
                    className="btn-open-logs"
                    onClick={(e) => { e.stopPropagation(); window.api.openLogsFolder(); }}
                  >
                    Open Logs Folder
                  </button>
                )}
              </button>
              {logsExpanded && (
                <div className="diag-log-scroll">
                  {logEntries.map((entry, i) => (
                    <div key={i} className={`diag-log-line diag-log-${entry.level.toLowerCase()}`}>
                      <span className="diag-log-time">{entry.timestamp.slice(11, 23)}</span>
                      <span className="diag-log-level">{entry.level}</span>
                      <span className="diag-log-component">[{entry.component}]</span>
                      <span className="diag-log-msg">{entry.message}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>
          )}

          {bulkState === "done" && summary && (
            <div className="bulk-summary">
              <div className="bulk-summary-counts">
                {summary.added > 0 && (
                  <span className="bulk-summary-stat bulk-summary-stat--success">
                    ✓ {summary.added} lead{summary.added !== 1 ? "s" : ""} added to Drafts
                  </span>
                )}
                {summary.skipped.length > 0 && (
                  <span className="bulk-summary-stat bulk-summary-stat--skipped">
                    ⊘ {summary.skipped.length} skipped (already in pipeline)
                  </span>
                )}
                {summary.failed.length > 0 && (
                  <span className="bulk-summary-stat bulk-summary-stat--fail">
                    ✗ {summary.failed.length} failed
                  </span>
                )}
              </div>

              {summary.skipped.length > 0 && (
                <div className="bulk-summary-skipped">
                  <div className="bulk-summary-skipped-label">Already in pipeline:</div>
                  {summary.skipped.map((s, i) => (
                    <div key={i} className="bulk-summary-skipped-item">
                      <span className="bulk-summary-skipped-name">{s.name}</span>
                      <span className="bulk-summary-skipped-stage">{s.stage}</span>
                    </div>
                  ))}
                </div>
              )}

              {summary.failed.length > 0 && (
                <div className="bulk-summary-failed">
                  <div className="bulk-summary-failed-label">Failed:</div>
                  {summary.failed.map((f, i) => (
                    <div key={i} className="bulk-summary-failed-item">
                      <span className="bulk-summary-failed-url">{f.url}</span>
                      <span className="bulk-summary-failed-reason">{f.reason}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bulk-summary-actions">
                {summary.added > 0 && (
                  <button
                    className="btn btn-primary"
                    onClick={() => navigate("/drafts")}
                  >
                    Go to Drafts
                  </button>
                )}
                <button className="btn btn-secondary" onClick={handleReset}>
                  Process More
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function ComposePage() {
  const [mode, setMode] = useState<Mode>("single");
  const [promptRefreshKey, setPromptRefreshKey] = useState(0);

  function handleConfigSaved() {
    setPromptRefreshKey((k) => k + 1);
  }

  return (
    <div className="container">
      <SenderConfigSection onSaved={handleConfigSaved} />
      <PromptPreviewSection refreshKey={promptRefreshKey} />

      <div className="compose-mode-row">
        <div className="mode-toggle">
          <button
            className={`mode-toggle-btn${mode === "single" ? " mode-toggle-btn--active" : ""}`}
            onClick={() => setMode("single")}
          >
            Single Profile
          </button>
          <button
            className={`mode-toggle-btn${mode === "bulk" ? " mode-toggle-btn--active" : ""}`}
            onClick={() => setMode("bulk")}
          >
            Bulk Profiles
          </button>
        </div>
      </div>

      {mode === "single" ? <SingleMode /> : <BulkMode />}
    </div>
  );
}
