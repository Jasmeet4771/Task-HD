
import { useState } from "react";
import "./Auth.css";

import {
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import { auth } from "../firebase";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      // Step 1: Authenticate using Firebase.
      const credential =
        await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

      const idToken =
        await credential.user.getIdToken(true);

      // Step 2: Ask the backend to send an OTP.
      const response = await fetch(
        `${API_BASE_URL}/api/auth/otp/request`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      const result = await response.json();

      // Step 3: End the temporary password-only session.
      await signOut(auth);

      if (!response.ok) {
        throw new Error(
          result.message ||
          "Unable to send verification code."
        );
      }

      // Store only the pending email, never the password.
      const normalizedEmail =
        email.trim().toLowerCase();

      sessionStorage.setItem(
        "devdeakin_pending_email",
        normalizedEmail
      );

      // Step 4: Redirect to OTP verification.
      navigate("/verify-otp", {
        replace: true,
        state: {
          email: normalizedEmail,
          maskedEmail: result.maskedEmail,
          resendAfterSeconds:
            result.resendAfterSeconds || 60,
        },
      });

    } catch (err) {
      if (auth.currentUser) {
        await signOut(auth);
      }

      console.error("Login error:", err);

      setError(
        err.code === "auth/invalid-credential"
          ? "Incorrect email or password."
          : err.message || "Login failed."
      );

    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">

        <h2>Login</h2>

        {location.state?.message && (
          <p role="status">
            {location.state.message}
          </p>
        )}

        <p>
          Enter your account details. We will send
          a verification code to your registered email.
        </p>

        <form onSubmit={handleSubmit}>

          <label htmlFor="login-email">
            Your email
          </label>

          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            autoComplete="email"
            required
          />

          <label htmlFor="login-password">
            Your password
          </label>

          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            autoComplete="current-password"
            required
          />

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Sending verification code..."
              : "Continue"}
          </button>

        </form>

        <p>
          Don't have an account?{" "}
          <Link to="/signup">Sign up</Link>
        </p>

      </section>
    </main>
  );
}

export default Login;
