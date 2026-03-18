import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Check, X, Ban, ArrowRight, Minus, Circle } from "lucide-react";
import ActivityFeed from "../components/ActivityFeed";
import { useBottomPanel } from "../components/BottomPanel";

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

interface UrlItemStatus {
  url: string;
  status: "pending" | "processing" | "done" | "skipped" | "error" | "cancelled";
  profileName?: string | null;
  skippedStage?: string;
  error?: string;
}

type SinglePageState = "idle" | "loading" | "success" | "error";
type BulkRunState = "idle" | "running" | "done";
type Mode = "single" | "bulk";

// ─── Single Profile Mode ──────────────────────────────────────────────────────

function SingleMode() {
  const { openPanel } = useBottomPanel();
  const [state, setState] = useState<SinglePageState>("idle");
  const [url, setUrl] = useState("");
  const [forceScrape, setForceScrape] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateCheckResult["lead"] | null>(null);
  const [activitySteps, setActivitySteps] = useState<ActivityStep[]>([]);
  const [createdLeadName, setCreatedLeadName] = useState<string | null>(null);

  const activityHandlerRef = useRef<ReturnType<typeof window.api.onActivityStep> | null>(null);
  const pendingUrlRef = useRef<string | null>(null);
  const pendingForceRef = useRef<boolean>(false);

  useEffect(() => {
    if (state === "loading") {
      setActivitySteps([]);
      const handler = window.api.onActivityStep((step) => {
        setActivitySteps((prev) => {
          const idx = prev.findIndex(s => s.stepId === step.stepId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = step as ActivityStep;
            return next;
          }
          return [...prev, step as ActivityStep];
        });
      });
      activityHandlerRef.current = handler;
    } else {
      if (activityHandlerRef.current) {
        window.api.offActivityStep(activityHandlerRef.current);
        activityHandlerRef.current = null;
      }
    }
  }, [state]);

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
    setActivitySteps([]);
    setCreatedLeadName(null);
  }

  const isLoading = state === "loading";

  return (
    <div className="compose-workspace compose-workspace--single">
      {/* Left: input area */}
      <div className="compose-workspace__input">
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

        {state !== "success" && (
          <form className="scrape-form compose-spotlight-form" onSubmit={handleSubmit}>
            <div className="compose-spotlight-input-wrap">
              <input
                id="compose-url-input"
                type="url"
                className="compose-spotlight-input"
                placeholder="Paste a LinkedIn profile URL…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isLoading}
                required
                autoFocus
              />
              <button
                type="submit"
                className="compose-spotlight-btn btn btn-primary"
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
      </div>

      {/* Right: result area */}
      <div className="compose-workspace__result">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
          </div>
        )}

        {duplicateInfo && (
          <div className="duplicate-banner">
            <div className="duplicate-banner__message">
              {duplicateMessage(duplicateInfo.stage)}
            </div>
            {duplicateInfo.stage.toLowerCase() !== "converted" && (
              <Link
                to={stageToRoute(duplicateInfo.stage)}
                className="duplicate-banner__link"
                className="btn-icon"
              >
                {stageLinkLabel(duplicateInfo.stage)} <ArrowRight size={14} />
              </Link>
            )}
          </div>
        )}

        {state === "success" && (
          <div className="success-banner">
            <span className="success-banner__icon">
              <Check size={16} />
            </span>
            <span className="success-banner__text">
              Lead{createdLeadName ? ` for ${createdLeadName}` : ""} created successfully.
            </span>
            <div className="success-banner__actions">
              <Link to="/drafts" className="btn btn-primary btn--sm">
                Go to Drafts to review
              </Link>
              <button className="btn btn-secondary btn--sm" onClick={handleReset}>
                Add Another
              </button>
            </div>
          </div>
        )}

        {(isLoading || activitySteps.length > 0) && (
          <ActivityFeed
            steps={activitySteps}
            onViewLogs={() => openPanel("logs")}
          />
        )}
      </div>
    </div>
  );
}

// ─── Bulk Profile Mode ────────────────────────────────────────────────────────

function BulkMode() {
  const navigate = useNavigate();
  const [bulkState, setBulkState] = useState<BulkRunState>("idle");
  const [rawUrls, setRawUrls] = useState("");
  const [forceScrape, setForceScrape] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [urlItems, setUrlItems] = useState<UrlItemStatus[]>([]);
  const [currentStepLabel, setCurrentStepLabel] = useState<string | null>(null);

  const [summary, setSummary] = useState<{
    added: number;
    skipped: Array<{ name: string; stage: string; url: string }>;
    failed: Array<{ url: string; reason: string }>;
  } | null>(null);

  const progressHandlerRef = useRef<ReturnType<typeof window.api.queue.onProgress> | null>(null);
  const activityHandlerRef = useRef<ReturnType<typeof window.api.onActivityStep> | null>(null);
  const urlListEndRef = useRef<HTMLDivElement | null>(null);

  const parsedUrls = parseUrlList(rawUrls);
  const validUrls = parsedUrls.filter(isLinkedInProfileUrl);
  const validCount = validUrls.length;
  const invalidCount = parsedUrls.filter((u) => !isLinkedInProfileUrl(u)).length;

  useEffect(() => {
    window.api.queue.getStatus().then((snapshot) => {
      const scrapeJobs = snapshot.dataQueue.filter(
        (item) =>
          item.type === "scrape-profile" &&
          (item.status === "queued" || item.status === "active")
      );
      if (scrapeJobs.length > 0) {
        setBulkState("running");
        setUrlItems(
          scrapeJobs.map((job) => ({
            url: job.payload.url as string,
            status: job.status === "active" ? "processing" : "pending",
          }))
        );
      }
    });

    const handler = window.api.queue.onProgress((item) => {
      if (item.type !== "scrape-profile") return;
      const url = item.payload.url as string;
      if (!url) return;

      setUrlItems((prev) => {
        const exists = prev.some((u) => u.url === url);
        const baseList = exists ? prev : [...prev, { url, status: "pending" as const }];
        return baseList.map((u) => {
          if (u.url !== url) return u;
          switch (item.status) {
            case "active":
              return { ...u, status: "processing" as const };
            case "completed": {
              const result = item.result as Record<string, unknown> | undefined;
              if (result && "duplicate" in result && result.duplicate) {
                const lead = result.lead as { stage?: string; name?: string } | undefined;
                return {
                  ...u,
                  status: "skipped" as const,
                  skippedStage: lead?.stage,
                  profileName: lead?.name,
                };
              }
              if (result && "success" in result && result.success) {
                const lead = result.lead as { name?: string | null } | undefined;
                return { ...u, status: "done" as const, profileName: lead?.name ?? null };
              }
              return { ...u, status: "done" as const };
            }
            case "failed":
              return { ...u, status: "error" as const, error: item.error ?? "Unknown error" };
            case "cancelled":
              return { ...u, status: "cancelled" as const };
            default:
              return u;
          }
        });
      });

      if (item.status === "active") {
        setBulkState((prev) => (prev === "idle" ? "running" : prev));
      }
    });

    progressHandlerRef.current = handler;

    const activityHandler = window.api.onActivityStep((step) => {
      if (step.status === "active") {
        setCurrentStepLabel(step.label);
      } else if (step.status === "completed" || step.status === "failed") {
        setCurrentStepLabel(null);
      }
    });
    activityHandlerRef.current = activityHandler;

    return () => {
      if (progressHandlerRef.current) {
        window.api.queue.removeProgressListener(progressHandlerRef.current);
        progressHandlerRef.current = null;
      }
      if (activityHandlerRef.current) {
        window.api.offActivityStep(activityHandlerRef.current);
        activityHandlerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (bulkState !== "running" || urlItems.length === 0) return;
    const allSettled = urlItems.every(
      (item) =>
        item.status === "done" ||
        item.status === "error" ||
        item.status === "skipped" ||
        item.status === "cancelled"
    );
    if (!allSettled) return;

    const added = urlItems.filter((i) => i.status === "done").length;
    const skipped = urlItems
      .filter((i) => i.status === "skipped")
      .map((i) => ({
        name: i.profileName || i.url,
        stage: i.skippedStage || "unknown",
        url: i.url,
      }));
    const failed = urlItems
      .filter((i) => i.status === "error")
      .map((i) => ({ url: i.url, reason: i.error || "Unknown error" }));

    setSummary({ added, skipped, failed });
    setBulkState("done");
    setCurrentStepLabel(null);
  }, [urlItems, bulkState]);

  useEffect(() => {
    if (bulkState === "running" && urlListEndRef.current) {
      urlListEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [urlItems, bulkState]);

  async function handleStart() {
    setError(null);
    setNeedsLogin(false);
    setSummary(null);
    setCurrentStepLabel(null);

    const items: UrlItemStatus[] = validUrls.map((u) => ({ url: u, status: "pending" as const }));
    setUrlItems(items);
    setBulkState("running");

    const result = await window.api.scrapeBulk(validUrls, forceScrape);

    if ("error" in result) {
      if (result.needsLogin) {
        setNeedsLogin(true);
      } else {
        setError(result.message);
      }
      setBulkState("idle");
      setUrlItems([]);
    }
  }

  async function handleCancel() {
    await window.api.queue.cancelAll("data");
  }

  function handleReset() {
    setBulkState("idle");
    setRawUrls("");
    setForceScrape(false);
    setError(null);
    setNeedsLogin(false);
    setUrlItems([]);
    setSummary(null);
    setCurrentStepLabel(null);
  }

  const completedCount = urlItems.filter(
    (i) =>
      i.status === "done" ||
      i.status === "error" ||
      i.status === "skipped" ||
      i.status === "cancelled"
  ).length;

  return (
    <div className="compose-workspace compose-workspace--bulk">
      {error && (
        <div className="error-banner compose-workspace__full-row">
          <strong>Error:</strong> {error}
        </div>
      )}

      {needsLogin && (
        <div className="login-prompt compose-workspace__full-row">
          <div className="login-prompt__text">
            <strong>LinkedIn login required.</strong> Your session is missing or has expired.
          </div>
          <button
            className="btn btn-login"
            onClick={async () => {
              setNeedsLogin(false);
              setError(null);
              const result = await window.api.login();
              if ("error" in result) {
                setError(result.message);
              }
            }}
          >
            Login to LinkedIn
          </button>
        </div>
      )}

      {/* Progress bar — full width, shown while running */}
      {(bulkState === "running" || bulkState === "done") && (
        <div className="compose-workspace__full-row">
          {bulkState === "running" && (
            <>
              <div className="bulk-progress-header">
                <div className="bulk-progress-label">
                  <span className="bulk-spinner" aria-hidden="true" />
                  Processing URLs — {completedCount} / {urlItems.length} done
                </div>
                <button className="btn btn-secondary btn--sm" onClick={handleCancel}>
                  Cancel
                </button>
              </div>
              <div className="bulk-progress-bar-track">
                <div
                  className="bulk-progress-bar-fill"
                  style={{
                    width:
                      urlItems.length > 0
                        ? `${(completedCount / urlItems.length) * 100}%`
                        : "0%",
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Side-by-side: input | progress list */}
      {bulkState === "idle" && (
        <>
          <div className="compose-workspace__input">
            <div className="bulk-form">
              <label className="form-label">LinkedIn Profile URLs (one per line)</label>
              <textarea
                className="bulk-textarea"
                placeholder={
                  "https://www.linkedin.com/in/person-one/\nhttps://www.linkedin.com/in/person-two/\nhttps://www.linkedin.com/in/person-three/"
                }
                value={rawUrls}
                onChange={(e) => setRawUrls(e.target.value)}
                rows={10}
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
          </div>

          <div className="compose-workspace__result compose-workspace__result--bulk-hint">
            <p className="compose-bulk-hint">
              Paste LinkedIn profile URLs on the left — one per line. Valid URLs will be queued and
              processed in order.
            </p>
          </div>
        </>
      )}

      {(bulkState === "running" || bulkState === "done") && (
        <>
          <div className="compose-workspace__input">
            <div className="bulk-url-list">
              {urlItems.map((item, i) => (
                <div key={i} className={`bulk-url-item bulk-url-item--${item.status}`}>
                  <span className="bulk-url-icon" aria-hidden="true">
                    {item.status === "done" && <Check size={14} />}
                    {item.status === "skipped" && <Ban size={14} />}
                    {item.status === "error" && <X size={14} />}
                    {item.status === "cancelled" && <Minus size={14} />}
                    {item.status === "processing" && <span className="bulk-spinner-inline" />}
                    {item.status === "pending" && <Circle size={8} />}
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
                          <span className="bulk-url-sub">
                            Already in pipeline — {item.skippedStage}
                          </span>
                        )}
                      </>
                    ) : item.status === "cancelled" ? (
                      <>
                        <span>{item.url}</span>
                        <span className="bulk-url-sub">Cancelled</span>
                      </>
                    ) : item.status === "processing" ? (
                      <>
                        <span>{item.url}</span>
                        {currentStepLabel && (
                          <span className="bulk-url-sub bulk-url-sub--step">{currentStepLabel}…</span>
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
          </div>

          {/* Summary panel on the right when done */}
          <div className="compose-workspace__result">

            {bulkState === "done" && summary && (
              <div className="bulk-summary">
                <div className="bulk-summary-counts">
                  {summary.added > 0 && (
                    <span className="bulk-summary-stat bulk-summary-stat--success btn-icon">
                      <Check size={14} /> {summary.added} lead{summary.added !== 1 ? "s" : ""}{" "}
                      added to Drafts
                    </span>
                  )}
                  {summary.skipped.length > 0 && (
                    <span className="bulk-summary-stat bulk-summary-stat--skipped btn-icon">
                      <Ban size={14} /> {summary.skipped.length} skipped (already in pipeline)
                    </span>
                  )}
                  {summary.failed.length > 0 && (
                    <span className="bulk-summary-stat bulk-summary-stat--fail btn-icon">
                      <X size={14} /> {summary.failed.length} failed
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
                    <button className="btn btn-primary" onClick={() => navigate("/drafts")}>
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
        </>
      )}

    </div>
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export default function ComposePage() {
  const [mode, setMode] = useState<Mode>("single");

  return (
    <div className="compose-page">
      <div className="compose-hero">
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
