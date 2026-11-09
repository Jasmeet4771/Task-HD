
import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import { auth } from "../firebase";
import { useAuth } from "../context/AuthContext";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

function SessionManager() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [settings, setSettings] = useState(null);
  const [warningVisible, setWarningVisible] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [activityError, setActivityError] = useState("");

  const lastActivityRef = useRef(Date.now());
  const lastServerUpdateRef = useRef(0);
  const logoutStartedRef = useRef(false);

  // Sign out the user and redirect to the login page.
  const forceLogout = useCallback(async () => {
    if (logoutStartedRef.current) return;

    logoutStartedRef.current = true;
    setWarningVisible(false);

    try {
      await signOut(auth);
    } catch (error) {
      console.error("Session logout error:", error);
    } finally {
      navigate("/login", {
        replace: true,
        state: {
          message: "Your session has expired. Please log in again.",
        },
      });
    }
  }, [navigate]);

  // Load the user's session settings from the backend.
  useEffect(() => {
    let mounted = true;

    setSettings(null);
    setWarningVisible(false);
    setActivityError("");

    logoutStartedRef.current = false;
    lastActivityRef.current = Date.now();
    lastServerUpdateRef.current = 0;

    if (!currentUser) {
      return () => {
        mounted = false;
      };
    }

    const loadSettings = async () => {
      try {
        const token = await currentUser.getIdToken();

        const response = await fetch(
          `${API_BASE_URL}/api/session/settings`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.status === 401) {
          await forceLogout();
          return;
        }

        if (!response.ok) {
          throw new Error("Unable to load session settings.");
        }

        const result = await response.json();

        if (mounted) {
          lastActivityRef.current = Date.now();
          setSettings(result.settings);
        }
      } catch (error) {
        console.error("Session settings error:", error);

        if (mounted) {
          setActivityError(
            "Unable to load session settings. Please refresh the page."
          );
        }
      }
    };

    loadSettings();

    // Reload settings when the user saves changes on the settings page.
    const handleSettingsChanged = () => {
      loadSettings();
    };

    window.addEventListener(
      "session-settings-updated",
      handleSettingsChanged
    );

    return () => {
      mounted = false;

      window.removeEventListener(
        "session-settings-updated",
        handleSettingsChanged
      );
    };
  }, [currentUser, forceLogout]);

  // Send the latest activity timestamp to the backend.
  const sendActivity = useCallback(async (force = false) => {
    if (!auth.currentUser) return false;

    const now = Date.now();

    // Prevent excessive activity requests.
    if (
      !force &&
      now - lastServerUpdateRef.current < 1000
    ) {
      return true;
    }

    lastServerUpdateRef.current = now;

    try {
      const token = await auth.currentUser.getIdToken();

      const response = await fetch(
        `${API_BASE_URL}/api/session/activity`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.status === 401) {
        await forceLogout();
        return false;
      }

      if (!response.ok) {
        console.error("Unable to update server session activity.");
        return false;
      }

      return true;
    } catch (error) {
      console.error("Session activity request failed:", error);
      return false;
    }
  }, [forceLogout]);

  // Monitor activity and inactivity.
  useEffect(() => {
    if (!currentUser || !settings) return;

    if (!settings.autoLogoutEnabled) {
      setWarningVisible(false);
      return;
    }

    const timeoutMs = settings.inactivityTimeoutMs;

    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 5000 ||
      timeoutMs > 60 * 60 * 1000
    ) {
      console.error("Invalid session timeout received.");
      return;
    }

    lastActivityRef.current = Date.now();

    const handleActivity = () => {
      if (logoutStartedRef.current) return;

      const now = Date.now();
      const inactiveDuration = now - lastActivityRef.current;

      // Do not allow activity to revive an expired session.
      if (inactiveDuration >= timeoutMs) {
        forceLogout();
        return;
      }

      lastActivityRef.current = now;
      setWarningVisible(false);
      setActivityError("");

      sendActivity();
    };

    const activityEvents = [
      "pointerdown",
      "keydown",
      "scroll",
      "touchstart",
      "mousemove",
    ];

    activityEvents.forEach(eventName => {
      window.addEventListener(eventName, handleActivity, {
        passive: true,
      });
    });

    // Check inactivity and update the warning countdown.
    const timer = window.setInterval(() => {
      if (logoutStartedRef.current) return;

      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = timeoutMs - elapsed;

      if (remaining <= 0) {
        forceLogout();
        return;
      }

      const warningDuration = Math.min(
        30000,
        Math.max(1000, Math.floor(timeoutMs / 3))
      );

      setRemainingSeconds(Math.ceil(remaining / 1000));
      setWarningVisible(remaining <= warningDuration);
    }, 200);

    return () => {
      window.clearInterval(timer);

      activityEvents.forEach(eventName => {
        window.removeEventListener(eventName, handleActivity);
      });
    };
  }, [currentUser, settings, forceLogout, sendActivity]);

  // Extend the session when the user clicks Stay signed in.
  const staySignedIn = async () => {
    if (!auth.currentUser || logoutStartedRef.current) return;

    lastActivityRef.current = Date.now();
    lastServerUpdateRef.current = 0;

    setWarningVisible(false);
    setActivityError("");

    const updated = await sendActivity(true);

    if (!updated && !logoutStartedRef.current) {
      setActivityError(
        "Unable to contact the server. Your session may expire."
      );
    }
  };

  if (
    !currentUser ||
    !settings ||
    !settings.autoLogoutEnabled ||
    !warningVisible
  ) {
    return null;
  }

  return (
    <div
      className="session-warning-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-warning-title"
    >
      <section className="session-warning-card">
        <div className="session-warning-icon">!</div>

        <h2 id="session-warning-title">
          Are you still there?
        </h2>

        <p>
          You have been inactive. For security, you will
          automatically be logged out.
        </p>

        <div className="session-countdown">
          {remainingSeconds} seconds
        </div>

        {activityError && (
          <p className="session-activity-error">
            {activityError}
          </p>
        )}

        <button
          type="button"
          onClick={staySignedIn}
        >
          Stay signed in
        </button>
      </section>
    </div>
  );
}

export default SessionManager;
