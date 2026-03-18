import { useEffect, useRef, useState } from "react";
import { Circle, Loader2, CheckCircle2, XCircle, MinusCircle } from "lucide-react";

interface ActivityFeedProps {
  steps: ActivityStep[];
  onViewLogs?: () => void;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StepIcon({ status }: { status: ActivityStep["status"] }) {
  switch (status) {
    case "active":
      return (
        <span className="activity-feed__icon activity-feed__icon--active" aria-label="Active">
          <Loader2 size={14} />
        </span>
      );
    case "completed":
      return (
        <span className="activity-feed__icon activity-feed__icon--completed" aria-label="Completed">
          <CheckCircle2 size={14} />
        </span>
      );
    case "failed":
      return (
        <span className="activity-feed__icon activity-feed__icon--failed" aria-label="Failed">
          <XCircle size={14} />
        </span>
      );
    case "skipped":
      return (
        <span className="activity-feed__icon activity-feed__icon--skipped" aria-label="Skipped">
          <MinusCircle size={14} />
        </span>
      );
    default:
      return (
        <span className="activity-feed__icon activity-feed__icon--pending" aria-label="Pending">
          <Circle size={10} />
        </span>
      );
  }
}

function LiveTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [startedAt]);

  return <span className="activity-feed__elapsed">{formatElapsed(elapsed)}</span>;
}

export default function ActivityFeed({ steps, onViewLogs }: ActivityFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);

  const totalStart = steps.find(s => s.startedAt)?.startedAt;
  const lastCompleted = [...steps].reverse().find(s => s.completedAt);
  const totalElapsed = totalStart && lastCompleted?.completedAt
    ? lastCompleted.completedAt - totalStart
    : undefined;

  const hasActiveStep = steps.some(s => s.status === "active");

  if (steps.length === 0) return null;

  return (
    <div className="activity-feed" ref={feedRef}>
      <div className="activity-feed__header">Activity</div>
      <div className="activity-feed__list" role="list">
        {steps.map((step) => (
          <div
            key={step.stepId}
            className={`activity-feed__step activity-feed__step--${step.status}`}
            role="listitem"
          >
            <StepIcon status={step.status} />
            <div className="activity-feed__step-body">
              <span className="activity-feed__label">{step.label}</span>
              {step.detail && step.status !== "failed" && (
                <span className="activity-feed__detail">{step.detail}</span>
              )}
              {step.error && step.status === "failed" && (
                <span className="activity-feed__error">{step.error}</span>
              )}
            </div>
            <div className="activity-feed__timing">
              {step.status === "active" && step.startedAt && (
                <LiveTimer startedAt={step.startedAt} />
              )}
              {(step.status === "completed" || step.status === "failed") &&
                step.startedAt && step.completedAt && (
                  <span className="activity-feed__elapsed">
                    {formatElapsed(step.completedAt - step.startedAt)}
                  </span>
                )}
            </div>
          </div>
        ))}
      </div>

      <div className="activity-feed__footer">
        <span className="activity-feed__total-time">
          {totalElapsed != null && !hasActiveStep
            ? `Total: ${formatElapsed(totalElapsed)}`
            : hasActiveStep
            ? "Processing…"
            : null}
        </span>
        <button
          className="activity-feed__logs-link"
          onClick={onViewLogs}
          type="button"
        >
          View Full Logs
        </button>
      </div>
    </div>
  );
}
