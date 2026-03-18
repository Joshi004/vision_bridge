import { useState, useEffect } from "react";
import { Check, ChevronDown, ChevronRight, Sun, Moon, Monitor } from "lucide-react";
import type { AppTheme } from "../App";

// ─── Sender Profile Section ───────────────────────────────────────────────────

function SenderProfileSection({ onSaved }: { onSaved: () => void }) {
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
        onSaved();
      }, 1500);
    } catch {
      // save failed silently — user can retry
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section__title">Sender Profile</h2>
      <p className="settings-section__description">
        Your identity and goals used when generating outreach messages.
      </p>

      <div className="settings-form">
        <div className="settings-form__row settings-form__row--two-col">
          <div className="settings-form__field">
            <label className="settings-form__label">Your Name</label>
            <input
              type="text"
              className="settings-form__input"
              placeholder="e.g. Naresh Joshi"
              value={fields.sender_name}
              onChange={(e) => handleFieldChange("sender_name", e.target.value)}
            />
          </div>
          <div className="settings-form__field">
            <label className="settings-form__label">Company</label>
            <input
              type="text"
              className="settings-form__input"
              placeholder="e.g. Techsergy"
              value={fields.company_name}
              onChange={(e) => handleFieldChange("company_name", e.target.value)}
            />
          </div>
        </div>

        <div className="settings-form__field">
          <label className="settings-form__label">What You Do</label>
          <textarea
            className="settings-form__textarea"
            rows={3}
            placeholder="A software delivery company that supports startups and product teams…"
            value={fields.company_description}
            onChange={(e) => handleFieldChange("company_description", e.target.value)}
          />
        </div>

        <div className="settings-form__field">
          <label className="settings-form__label">Your Role</label>
          <textarea
            className="settings-form__textarea"
            rows={2}
            placeholder="Senior technical lead. Delivery handled through my team…"
            value={fields.sender_role}
            onChange={(e) => handleFieldChange("sender_role", e.target.value)}
          />
        </div>

        <div className="settings-form__field">
          <label className="settings-form__label">Outreach Goal</label>
          <textarea
            className="settings-form__textarea"
            rows={2}
            placeholder="Explore engineering collaboration opportunities…"
            value={fields.outreach_goal}
            onChange={(e) => handleFieldChange("outreach_goal", e.target.value)}
          />
        </div>

        <div className="settings-form__row settings-form__row--two-col">
          <div className="settings-form__field">
            <label className="settings-form__label">Message Tone</label>
            <textarea
              className="settings-form__textarea"
              rows={3}
              placeholder="Friendly and natural. Sound like a real human…"
              value={fields.message_tone}
              onChange={(e) => handleFieldChange("message_tone", e.target.value)}
            />
          </div>
          <div className="settings-form__field">
            <label className="settings-form__label">Message Rules</label>
            <textarea
              className="settings-form__textarea"
              rows={3}
              placeholder="No em dashes, no bullet points. Reference their profile genuinely…"
              value={fields.message_rules}
              onChange={(e) => handleFieldChange("message_rules", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="settings-section__footer">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? "Saving…" : "Save Configuration"}
        </button>
        {saveSuccess && (
          <span className="settings-save-status">
            <Check size={14} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Prompt Template Section ──────────────────────────────────────────────────

function PromptTemplateSection({ refreshKey }: { refreshKey: number }) {
  const [variant, setVariant] = useState<"cold" | "referral">("cold");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!isExpanded) return;
    setIsLoading(true);
    setError(null);
    setPrompt(null);
    const call =
      variant === "referral"
        ? window.api.getPromptPreviewWithReferral()
        : window.api.getPromptPreview();
    call
      .then((result) => {
        if ("success" in result && result.success) {
          setPrompt(result.prompt);
        } else if ("error" in result) {
          setError(result.message);
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isExpanded, variant, refreshKey]);

  return (
    <div className="settings-section">
      <button
        className="settings-section__expand-toggle"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
      >
        <span className="settings-section__expand-icon">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <div>
          <h2 className="settings-section__title settings-section__title--inline">
            Prompt Template
          </h2>
          <p className="settings-section__description">
            Preview the system prompt sent to the model for message generation.
          </p>
        </div>
      </button>

      {isExpanded && (
        <div className="settings-prompt-body">
          <div className="prompt-preview__variant-tabs">
            <button
              className={`prompt-preview__variant-tab${variant === "cold" ? " prompt-preview__variant-tab--active" : ""}`}
              onClick={() => setVariant("cold")}
            >
              Cold Outreach
            </button>
            <button
              className={`prompt-preview__variant-tab${variant === "referral" ? " prompt-preview__variant-tab--active" : ""}`}
              onClick={() => setVariant("referral")}
            >
              Referral Conversation
            </button>
          </div>

          {isLoading && (
            <div className="prompt-preview__loading">Loading prompt…</div>
          )}
          {error && <div className="prompt-preview__error">{error}</div>}
          {!isLoading && !error && prompt && (
            <pre className="prompt-preview__text">{prompt}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Appearance Section ───────────────────────────────────────────────────────

interface AppearanceSectionProps {
  theme: AppTheme;
  onThemeChange: (t: AppTheme) => void;
}

const themeOptions: { value: AppTheme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
  { value: "system", label: "System", icon: <Monitor size={14} /> },
];

function AppearanceSection({ theme, onThemeChange }: AppearanceSectionProps) {
  return (
    <div className="settings-section">
      <div className="settings-appearance">
        <div>
          <h2 className="settings-section__title">Appearance</h2>
          <p className="settings-section__description">Choose your preferred color theme.</p>
        </div>
        <div className="settings-theme-toggle">
          {themeOptions.map(({ value, label, icon }) => (
            <button
              key={value}
              className={`settings-theme-btn${theme === value ? " settings-theme-btn--active" : ""}`}
              onClick={() => onThemeChange(value)}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

interface SettingsPageProps {
  theme: AppTheme;
  onThemeChange: (t: AppTheme) => void;
}

export default function SettingsPage({ theme, onThemeChange }: SettingsPageProps) {
  const [promptRefreshKey, setPromptRefreshKey] = useState(0);

  function handleConfigSaved() {
    setPromptRefreshKey((k) => k + 1);
  }

  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <h1 className="settings-page__title">Settings</h1>
      </div>
      <div className="settings-page__content">
        <AppearanceSection theme={theme} onThemeChange={onThemeChange} />
        <SenderProfileSection onSaved={handleConfigSaved} />
        <PromptTemplateSection refreshKey={promptRefreshKey} />
      </div>
    </div>
  );
}
