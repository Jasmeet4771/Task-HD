
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import "./SecuritySettings.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

const PRESET_TIMEOUTS = [
  { label: "5 seconds (testing)", value: 5 },
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
  { label: "5 minutes", value: 300 },
  { label: "10 minutes", value: 600 },
  { label: "15 minutes", value: 900 },
  { label: "30 minutes", value: 1800 },
  { label: "1 hour", value: 3600 },
];

function SecuritySettings() {
  const [enabled, setEnabled] = useState(true);
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const [customSeconds, setCustomSeconds] = useState("");
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const getToken = async () => {
    if (!auth.currentUser) {
      throw new Error("Please log in again.");
    }

    return auth.currentUser.getIdToken();
  };

  const authenticatedFetch = async (url, options = {}) => {
    const token = await getToken();

    return fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  };

  const loadSettings = async () => {
    const response = await authenticatedFetch("/api/session/settings");
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Unable to load settings.");
    }

    setEnabled(result.settings.autoLogoutEnabled);
    setTimeoutSeconds(
      result.settings.inactivityTimeoutMs / 1000
    );
  };

  const loadSessions = async () => {
    const response = await authenticatedFetch("/api/session/active");
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Unable to load sessions.");
    }

    setSessions(result.sessions || []);
    setCurrentSessionId(result.currentSessionId || "");
  };

  const loadPage = async () => {
    setLoading(true);
    setError("");

    try {
      await Promise.all([loadSettings(), loadSessions()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await authenticatedFetch(
        "/api/session/settings",
        {
          method: "PUT",
          body: JSON.stringify({
            autoLogoutEnabled: enabled,
            inactivityTimeoutMs: timeoutSeconds * 1000,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Unable to save settings.");
      }

      setMessage("Your session settings have been saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const revokeSession = async sessionId => {
    const confirmed = window.confirm(
      "Are you sure you want to log out this device?"
    );

    if (!confirmed) return;

    try {
      const response = await authenticatedFetch(
        `/api/session/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Unable to revoke session.");
      }

      if (result.currentSession) {
        await signOut(auth);
        window.location.href = "/login";
        return;
      }

      setMessage("The selected device has been logged out.");
      await loadSessions();
    } catch (err) {
      setError(err.message);
    }
  };

  const logoutAllDevices = async () => {
    const confirmed = window.confirm(
      "This will log out every device, including this one. Continue?"
    );

    if (!confirmed) return;

    try {
      const response = await authenticatedFetch(
        "/api/session/logout-all",
        { method: "POST" }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Unable to log out devices.");
      }

      await signOut(auth);
      window.location.href = "/login";
    } catch (err) {
      setError(err.message);
    }
  };

  const applyCustomTimeout = () => {
    const value = Number(customSeconds);

    if (
      !Number.isInteger(value) ||
      value < 5 ||
      value > 3600
    ) {
      setError("Enter a whole number between 5 and 3600 seconds.");
      return;
    }

    setTimeoutSeconds(value);
    setError("");
    setMessage("");
  };

  const formatDate = timestamp => {
    if (!timestamp) return "Not available";

    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return <main className="security-page"><p>Loading security settings...</p></main>;
  }

  return (
    <main className="security-page">
      <div className="security-container">
        <header className="security-header">
          <p className="security-eyebrow">ACCOUNT PROTECTION</p>
          <h1>Security Settings</h1>
          <p>Manage your session timeout and signed-in devices.</p>
        </header>

        <section className="security-panel">
          <h2>Automatic logout</h2>
          <p>
            Automatically sign out when you have been inactive for your
            selected period.
          </p>

          <label className="security-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={event => setEnabled(event.target.checked)}
            />
            <span>Enable automatic logout</span>
          </label>

          <label htmlFor="session-timeout">
            Inactivity timeout
          </label>

          <select
            id="session-timeout"
            value={
              PRESET_TIMEOUTS.some(item => item.value === timeoutSeconds)
                ? timeoutSeconds
                : "custom"
            }
            onChange={event => {
              if (event.target.value !== "custom") {
                setTimeoutSeconds(Number(event.target.value));
                setMessage("");
              }
            }}
            disabled={!enabled}
          >
            {PRESET_TIMEOUTS.map(item => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
            <option value="custom">Custom duration</option>
          </select>

          <div className="security-custom-time">
            <label htmlFor="custom-seconds">
              Custom duration in seconds (5–3600)
            </label>

            <div className="security-custom-row">
              <input
                id="custom-seconds"
                type="number"
                min="5"
                max="3600"
                step="1"
                value={customSeconds}
                onChange={event => setCustomSeconds(event.target.value)}
                disabled={!enabled}
                placeholder="Enter seconds"
              />

              <button
                type="button"
                onClick={applyCustomTimeout}
                disabled={!enabled}
              >
                Apply
              </button>
            </div>
          </div>

          <p className="security-hint">
            Current timeout: {timeoutSeconds} seconds
            {enabled ? "" : " (automatic logout disabled)"}.
          </p>

          <button
            type="button"
            className="security-primary-button"
            onClick={saveSettings}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </section>

        <section className="security-panel">
          <div className="security-session-heading">
            <div>
              <h2>Active sessions</h2>
              <p>Devices currently signed in to your account.</p>
            </div>

            <button type="button" onClick={loadSessions}>
              Refresh
            </button>
          </div>

          {sessions.length === 0 ? (
            <p>No active sessions found.</p>
          ) : (
            <div className="security-session-list">
              {sessions.map(session => (
                <article className="security-session" key={session.id}>
                  <div>
                    <strong>
                      {session.current ? "This device" : "Other device"}
                    </strong>

                    <p>{session.userAgent}</p>

                    <small>
                      Signed in: {formatDate(session.createdAt)}
                    </small>

                    <small>
                      Last activity: {formatDate(session.lastActivityAt)}
                    </small>
                  </div>

                  {session.current ? (
                    <span className="security-current-label">
                      Current session
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="security-revoke-button"
                      onClick={() => revokeSession(session.id)}
                    >
                      Log out
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}

          <button
            type="button"
            className="security-danger-button"
            onClick={logoutAllDevices}
          >
            Log out from all devices
          </button>
        </section>

        {message && (
          <p className="security-success" role="status">{message}</p>
        )}

        {error && (
          <p className="security-error" role="alert">{error}</p>
        )}
      </div>
    </main>
  );
}

export default SecuritySettings;
