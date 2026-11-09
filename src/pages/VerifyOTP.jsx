
import { useEffect, useState } from "react";

import {
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  signInWithCustomToken,
  signOut,
} from "firebase/auth";

import { auth } from "../firebase";

import "./Auth.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000";

function VerifyOTP() {
  const location = useLocation();
  const navigate = useNavigate();

  const email =
    location.state?.email ||
    sessionStorage.getItem(
      "devdeakin_pending_email"
    ) ||
    "";

  const maskedEmail =
    location.state?.maskedEmail || email;

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const [resendSeconds, setResendSeconds] =
    useState(
      location.state?.resendAfterSeconds || 0
    );

  // Countdown for resend button.
  useEffect(() => {
    if (resendSeconds <= 0) return undefined;

    const timer = setInterval(() => {
      setResendSeconds((previous) =>
        Math.max(0, previous - 1)
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [resendSeconds]);

  // Verify OTP.
  const handleVerify = async (event) => {
    event.preventDefault();

    setError("");
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/otp/verify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            code,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message ||
          "Verification failed."
        );
      }

      // Exchange custom token for Firebase session.
      const credential = await signInWithCustomToken(
        auth,
        result.customToken
      );

      // Force refresh and check the MFA claim.
      const tokenResult =
        await credential.user.getIdTokenResult(true);

      if (tokenResult.claims.mfaVerified !== true) {
        await signOut(auth);

        throw new Error(
          "Two-factor verification could not be confirmed."
        );
      }

      sessionStorage.removeItem(
        "devdeakin_pending_email"
      );

      navigate("/", { replace: true });

    } catch (err) {
      console.error("OTP verification error:", err);

      setError(
        err.message ||
        "Unable to verify your code."
      );

    } finally {
      setLoading(false);
    }
  };

  // Resend OTP.
  const handleResend = async () => {
    setError("");
    setMessage("");
    setResending(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/otp/resend`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        const waitMatch =
          result.message?.match(/wait (\d+) seconds/);

        if (waitMatch) {
          setResendSeconds(
            Number(waitMatch[1])
          );
        }

        throw new Error(
          result.message ||
          "Unable to resend code."
        );
      }

      setResendSeconds(
        result.resendAfterSeconds || 60
      );

      setMessage(
        result.message ||
        "A new verification code has been sent."
      );

    } catch (err) {
      setError(err.message);

    } finally {
      setResending(false);
    }
  };

  if (!email) {
    return (
      <main className="auth-page">
        <section className="auth-card">

          <h2>Verification Required</h2>

          <p>
            Your verification details are missing.
            Please log in again.
          </p>

          <Link to="/login">
            Return to login
          </Link>

        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">

        <h2>Two-Factor Authentication</h2>

        <p>
          We sent a six-digit verification code to:
        </p>

        <p>
          <strong>{maskedEmail}</strong>
        </p>

        <form onSubmit={handleVerify}>

          <label htmlFor="otp-code">
            Verification Code
          </label>

          <input
            id="otp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) =>
              setCode(
                event.target.value
                  .replace(/\D/g, "")
                  .slice(0, 6)
              )
            }
            placeholder="Enter 6-digit code"
            required
          />

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          {message && (
            <p role="status">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
          >
            {loading
              ? "Verifying..."
              : "Verify and Sign In"}
          </button>

        </form>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending || resendSeconds > 0}
        >
          {resending
            ? "Sending..."
            : resendSeconds > 0
              ? `Resend in ${resendSeconds}s`
              : "Resend Verification Code"}
        </button>

        <p>
          <Link
            to="/login"
            onClick={() =>
              sessionStorage.removeItem(
                "devdeakin_pending_email"
              )
            }
          >
            Back to login
          </Link>
        </p>

      </section>
    </main>
  );
}

export default VerifyOTP;
