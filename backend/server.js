
const cors = require("cors");
const express = require("express");
const dotenv = require("dotenv");
const sgMail = require("@sendgrid/mail");
const path = require("path");
const crypto = require("crypto");

const {
  initializeApp,
  cert,
  getApps,
} = require("firebase-admin/app");

const { getAuth } = require("firebase-admin/auth");

const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");

dotenv.config({
  path: path.join(__dirname, ".env"),
});

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------------------------------------
// CORS AND EXPRESS CONFIGURATION
// --------------------------------------------------

const allowedOrigins = [
  "http://localhost:5173",
  "https://devdeakinjasmeet4771.vercel.app",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "50kb" }));

// --------------------------------------------------
// FIREBASE ADMIN INITIALIZATION
// --------------------------------------------------

const serviceAccount = require(
  path.join(__dirname, "service-account.json")
);

const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });

const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

console.log("Firebase Admin initialized successfully.");

// --------------------------------------------------
// SESSION CONFIGURATION
// --------------------------------------------------

const SESSION_COLLECTION = "userSessions";
const SESSION_SETTINGS_COLLECTION = "sessionSettings";

const DEFAULT_SESSION_SETTINGS = {
  autoLogoutEnabled: true,
  inactivityTimeoutMs: 5 * 60 * 1000,
};

const MIN_TIMEOUT_MS = 5 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;

// Sessions have a maximum lifetime of 24 hours,
// even when inactivity logout is disabled.
const ABSOLUTE_SESSION_LIMIT_MS = 24 * 60 * 60 * 1000;

// Retrieve the user's saved session preferences.
async function getSessionSettings(uid) {
  const snapshot = await db
    .collection(SESSION_SETTINGS_COLLECTION)
    .doc(uid)
    .get();

  if (!snapshot.exists) {
    return { ...DEFAULT_SESSION_SETTINGS };
  }

  const saved = snapshot.data();

  return {
    autoLogoutEnabled: saved.autoLogoutEnabled !== false,

    inactivityTimeoutMs:
      Number.isInteger(saved.inactivityTimeoutMs) &&
      saved.inactivityTimeoutMs >= MIN_TIMEOUT_MS &&
      saved.inactivityTimeoutMs <= MAX_TIMEOUT_MS
        ? saved.inactivityTimeoutMs
        : DEFAULT_SESSION_SETTINGS.inactivityTimeoutMs,
  };
}

// Validate a Firebase user's server-side application session.
async function validateApplicationSession(decodedToken) {
  if (
    decodedToken.mfaVerified !== true ||
    !decodedToken.sessionId
  ) {
    throw new Error("MFA_SESSION_REQUIRED");
  }

  const sessionRef = db
    .collection(SESSION_COLLECTION)
    .doc(decodedToken.sessionId);

  const sessionSnapshot = await sessionRef.get();

  if (!sessionSnapshot.exists) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const session = sessionSnapshot.data();

  if (
    session.uid !== decodedToken.uid ||
    session.revoked === true
  ) {
    throw new Error("SESSION_REVOKED");
  }

  const now = Date.now();
  const createdAt = Number(session.createdAt);
  const lastActivityAt = Number(session.lastActivityAt);

  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(lastActivityAt)
  ) {
    await sessionRef.update({ revoked: true });
    throw new Error("SESSION_EXPIRED");
  }

  // Enforce the maximum absolute session lifetime.
  if (now - createdAt >= ABSOLUTE_SESSION_LIMIT_MS) {
    await sessionRef.update({ revoked: true });
    throw new Error("SESSION_EXPIRED");
  }

  const settings = await getSessionSettings(decodedToken.uid);

  // Enforce the user's inactivity preference.
  if (
    settings.autoLogoutEnabled &&
    now - lastActivityAt >= settings.inactivityTimeoutMs
  ) {
    await sessionRef.update({ revoked: true });
    throw new Error("SESSION_EXPIRED");
  }

  return {
    sessionId: decodedToken.sessionId,
    sessionRef,
    session,
    settings,
  };
}

// --------------------------------------------------
// AUTHENTICATION MIDDLEWARE
// --------------------------------------------------

async function verifyUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Please log in to continue.",
      });
    }

    const token = authHeader.split(" ")[1];

    const decodedToken = await auth.verifyIdToken(token, true);

    const sessionInfo = await validateApplicationSession(
      decodedToken
    );

    req.user = decodedToken;
    req.applicationSession = sessionInfo;

    return next();
  } catch (error) {
    if (error.message === "MFA_SESSION_REQUIRED") {
      return res.status(403).json({
        message: "Complete two-factor authentication to continue.",
      });
    }

    if (
      [
        "SESSION_NOT_FOUND",
        "SESSION_REVOKED",
        "SESSION_EXPIRED",
      ].includes(error.message)
    ) {
      return res.status(401).json({
        message: "Your session has expired. Please log in again.",
        code: "SESSION_EXPIRED",
      });
    }

    console.error("Authentication error:", error.message);

    return res.status(401).json({
      message: "Invalid or expired login session.",
    });
  }
}

async function verifyUserPlan(req, res, next) {
  try {
    const userSnapshot = await db
      .collection("users")
      .doc(req.user.uid)
      .get();

    if (!userSnapshot.exists) {
      return res.status(403).json({
        message: "User profile not found.",
      });
    }

    const userData = userSnapshot.data();

    req.userProfile = {
      ...userData,
      plan: userData.plan === "paid" ? "paid" : "free",
    };

    return next();
  } catch (error) {
    console.error("Subscription verification error:", error);

    return res.status(500).json({
      message: "Unable to verify your subscription.",
    });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // Public visitors can browse free posts.
    if (!authHeader) {
      req.subscriptionPlan = "free";
      return next();
    }

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Invalid authentication header.",
      });
    }

    const token = authHeader.split(" ")[1];

    const decodedToken = await auth.verifyIdToken(token, true);

    const sessionInfo = await validateApplicationSession(
      decodedToken
    );

    const userSnapshot = await db
      .collection("users")
      .doc(decodedToken.uid)
      .get();

    const userData = userSnapshot.exists
      ? userSnapshot.data()
      : {};

    req.user = decodedToken;
    req.applicationSession = sessionInfo;
    req.subscriptionPlan =
      userData.plan === "paid" ? "paid" : "free";

    return next();
  } catch (error) {
    if (
      [
        "SESSION_NOT_FOUND",
        "SESSION_REVOKED",
        "SESSION_EXPIRED",
      ].includes(error.message)
    ) {
      return res.status(401).json({
        message: "Your session has expired. Please log in again.",
        code: "SESSION_EXPIRED",
      });
    }

    console.error("Optional authentication error:", error.message);

    return res.status(401).json({
      message: "Invalid or expired login session.",
    });
  }
}

// --------------------------------------------------
// POST VALIDATION
// --------------------------------------------------

function validatePost(data) {
  const {
    type,
    plan,
    title,
    tags,
    description,
    abstract,
    articleText,
  } = data;

  if (!["Question", "Article"].includes(type)) {
    return "Invalid post type.";
  }

  if (!["free", "paid"].includes(plan)) {
    return "Invalid post plan.";
  }

  if (
    typeof title !== "string" ||
    title.trim().length < 4 ||
    title.trim().length > 120
  ) {
    return "Title must be between 4 and 120 characters.";
  }

  if (
    !Array.isArray(tags) ||
    tags.length < 1 ||
    tags.length > 3
  ) {
    return "Please provide between 1 and 3 tags.";
  }

  if (
    tags.some(
      tag =>
        typeof tag !== "string" ||
        tag.trim().length < 1 ||
        tag.trim().length > 30
    )
  ) {
    return "Each tag must contain between 1 and 30 characters.";
  }

  const normalizedTags = tags.map(
    tag => tag.trim().toLowerCase()
  );

  if (new Set(normalizedTags).size !== normalizedTags.length) {
    return "Duplicate tags are not allowed.";
  }

  if (type === "Question") {
    if (
      typeof description !== "string" ||
      description.trim().length < 10 ||
      description.trim().length > 5000
    ) {
      return "Question details must be between 10 and 5000 characters.";
    }
  }

  if (type === "Article") {
    if (
      typeof abstract !== "string" ||
      abstract.trim().length < 10 ||
      abstract.trim().length > 500
    ) {
      return "Abstract must be between 10 and 500 characters.";
    }

    if (
      typeof articleText !== "string" ||
      articleText.trim().length < 50 ||
      articleText.trim().length > 20000
    ) {
      return "Article text must be between 50 and 20000 characters.";
    }
  }

  return null;
}

// --------------------------------------------------
// TWO-FACTOR AUTHENTICATION CONFIGURATION
// --------------------------------------------------

const OTP_COLLECTION = "loginOtpChallenges";
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_RESEND_WAIT_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function hashOtp(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function createOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function maskEmail(email) {
  const [name, domain] = email.split("@");

  if (!domain) return email;

  return `${name.slice(0, 2)}***@${domain}`;
}

async function sendLoginOtp(email, code) {
  if (
    !process.env.SENDGRID_API_KEY ||
    !process.env.SENDGRID_FROM_EMAIL
  ) {
    throw new Error("SendGrid is not configured on the server.");
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  await sgMail.send({
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: "Your DEV@Deakin verification code",
    text: `Your DEV@Deakin verification code is ${code}. It expires in five minutes. If you did not request this code, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px">
        <h2>DEV@Deakin sign-in verification</h2>
        <p>Use the following code to finish signing in:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#f3f6fa;text-align:center">
          ${code}
        </div>
        <p>This code expires in five minutes and can only be used once.</p>
        <p>If you did not try to sign in, you can ignore this email.</p>
      </div>
    `,
  });
}

async function issueOtpForUser(userRecord, res) {
  const challengeRef = db
    .collection(OTP_COLLECTION)
    .doc(userRecord.uid);

  const existing = await challengeRef.get();
  const now = Date.now();

  if (existing.exists) {
    const previous = existing.data();
    const elapsed = now - (previous.lastSentAt || 0);

    if (elapsed < OTP_RESEND_WAIT_MS) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil(
          (OTP_RESEND_WAIT_MS - elapsed) / 1000
        )} seconds before requesting another code.`,
      });
    }
  }

  const code = createOtp();

  await sendLoginOtp(userRecord.email, code);

  await challengeRef.set({
    otpHash: hashOtp(code),
    expiresAt: now + OTP_EXPIRY_MS,
    lastSentAt: now,
    attempts: 0,
    createdAt: now,
  });

  return res.status(200).json({
    success: true,
    message: "A verification code has been sent to your email.",
    maskedEmail: maskEmail(userRecord.email),
  });
}

// Request the first OTP after Firebase password authentication.
app.post("/api/auth/otp/request", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Please log in first.",
      });
    }

    const decoded = await auth.verifyIdToken(
      authHeader.split(" ")[1]
    );

    const userRecord = await auth.getUser(decoded.uid);

    if (!userRecord.email) {
      return res.status(400).json({
        message: "Your account does not have an email address.",
      });
    }

    return await issueOtpForUser(userRecord, res);
  } catch (error) {
    console.error(
      "OTP request error:",
      error.response?.body || error.message
    );

    return res.status(500).json({
      message: "Unable to send the verification code. Please try again.",
    });
  }
});

// Resend an OTP when a sign-in challenge exists.
app.post("/api/auth/otp/resend", async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Enter a valid email address.",
      });
    }

    let userRecord;

    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (error) {
      return res.status(200).json({
        message:
          "If a sign-in is pending, a new code will be sent when available.",
      });
    }

    const challenge = await db
      .collection(OTP_COLLECTION)
      .doc(userRecord.uid)
      .get();

    if (!challenge.exists) {
      return res.status(200).json({
        message:
          "If a sign-in is pending, a new code will be sent when available.",
      });
    }

    return await issueOtpForUser(userRecord, res);
  } catch (error) {
    console.error(
      "OTP resend error:",
      error.response?.body || error.message
    );

    return res.status(500).json({
      message: "Unable to resend the verification code.",
    });
  }
});

// Verify OTP, create a server-side session and issue a custom token.
app.post("/api/auth/otp/verify", async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const code =
      typeof req.body?.code === "string"
        ? req.body.code.trim()
        : "";

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^\d{6}$/.test(code)
    ) {
      return res.status(400).json({
        message: "Enter a valid email address and six-digit code.",
      });
    }

    let userRecord;

    try {
      userRecord = await auth.getUserByEmail(email);
    } catch {
      return res.status(400).json({
        message: "The verification code is invalid or expired.",
      });
    }

    const challengeRef = db
      .collection(OTP_COLLECTION)
      .doc(userRecord.uid);

    const now = Date.now();
    const submittedHash = Buffer.from(hashOtp(code), "hex");

    const verified = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(challengeRef);

      if (!snapshot.exists) return false;

      const challenge = snapshot.data();

      if (
        now > challenge.expiresAt ||
        challenge.attempts >= OTP_MAX_ATTEMPTS
      ) {
        transaction.delete(challengeRef);
        return false;
      }

      const storedHash = Buffer.from(challenge.otpHash, "hex");

      const matches =
        storedHash.length === submittedHash.length &&
        crypto.timingSafeEqual(storedHash, submittedHash);

      if (!matches) {
        transaction.update(challengeRef, {
          attempts: (challenge.attempts || 0) + 1,
        });

        return false;
      }

      transaction.delete(challengeRef);
      return true;
    });

    if (!verified) {
      return res.status(400).json({
        message:
          "The verification code is invalid, expired, or has reached its attempt limit.",
      });
    }

    // Create the session only after successful OTP verification.
    const sessionId = crypto.randomUUID();

    await db.collection(SESSION_COLLECTION).doc(sessionId).set({
      uid: userRecord.uid,
      createdAt: now,
      lastActivityAt: now,
      revoked: false,
      userAgent: String(
        req.headers["user-agent"] || "Unknown device"
      ).slice(0, 250),
    });

    // The custom token carries both MFA status and the session ID.
    const customToken = await auth.createCustomToken(
      userRecord.uid,
      {
        mfaVerified: true,
        sessionId,
      }
    );

    return res.status(200).json({
      success: true,
      customToken,
      message: "Email verified successfully.",
    });
  } catch (error) {
    console.error("OTP verification error:", error.message);

    return res.status(500).json({
      message: "Unable to verify the code. Please try again.",
    });
  }
});

// --------------------------------------------------
// SESSION MANAGEMENT API
// --------------------------------------------------

// Get the current user's session preferences.
app.get("/api/session/settings", verifyUser, async (req, res) => {
  try {
    const settings = await getSessionSettings(req.user.uid);

    return res.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error("Get session settings error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve session settings.",
    });
  }
});

// Save the user's inactivity timeout preferences.
app.put("/api/session/settings", verifyUser, async (req, res) => {
  try {
    const {
      autoLogoutEnabled,
      inactivityTimeoutMs,
    } = req.body || {};

    if (typeof autoLogoutEnabled !== "boolean") {
      return res.status(400).json({
        message: "Invalid automatic logout setting.",
      });
    }

    if (
      !Number.isInteger(inactivityTimeoutMs) ||
      inactivityTimeoutMs < MIN_TIMEOUT_MS ||
      inactivityTimeoutMs > MAX_TIMEOUT_MS
    ) {
      return res.status(400).json({
        message: "Timeout must be between 5 seconds and 1 hour.",
      });
    }

    await db
      .collection(SESSION_SETTINGS_COLLECTION)
      .doc(req.user.uid)
      .set(
        {
          autoLogoutEnabled,
          inactivityTimeoutMs,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    return res.json({
      success: true,
      message: "Session settings updated.",
      settings: {
        autoLogoutEnabled,
        inactivityTimeoutMs,
      },
    });
  } catch (error) {
    console.error("Update session settings error:", error.message);

    return res.status(500).json({
      message: "Unable to update session settings.",
    });
  }
});

// Update activity timestamp for the current session.
app.post("/api/session/activity", verifyUser, async (req, res) => {
  try {
    const now = Date.now();

    await req.applicationSession.sessionRef.update({
      lastActivityAt: now,
    });

    return res.json({
      success: true,
      serverTime: now,
    });
  } catch (error) {
    console.error("Session activity error:", error.message);

    return res.status(500).json({
      message: "Unable to update session activity.",
    });
  }
});

// Return active sessions belonging to the authenticated user.
app.get("/api/session/active", verifyUser, async (req, res) => {
  try {
    const snapshot = await db
      .collection(SESSION_COLLECTION)
      .where("uid", "==", req.user.uid)
      .get();

    const settings = await getSessionSettings(req.user.uid);
    const now = Date.now();
    const sessions = [];
    const expiredRefs = [];

    snapshot.docs.forEach(document => {
      const data = document.data();

      if (data.revoked === true) return;

      const createdAt = Number(data.createdAt);
      const lastActivityAt = Number(data.lastActivityAt);

      const absoluteExpired =
        !Number.isFinite(createdAt) ||
        now - createdAt >= ABSOLUTE_SESSION_LIMIT_MS;

      const inactivityExpired =
        settings.autoLogoutEnabled &&
        (
          !Number.isFinite(lastActivityAt) ||
          now - lastActivityAt >= settings.inactivityTimeoutMs
        );

      if (absoluteExpired || inactivityExpired) {
        expiredRefs.push(document.ref);
        return;
      }

      sessions.push({
        id: document.id,
        createdAt: data.createdAt,
        lastActivityAt: data.lastActivityAt,
        userAgent: data.userAgent || "Unknown device",
        current:
          document.id === req.applicationSession.sessionId,
      });
    });

    // Mark expired records as revoked so they do not remain active.
    for (let i = 0; i < expiredRefs.length; i += 450) {
      const batch = db.batch();

      expiredRefs.slice(i, i + 450).forEach(ref => {
        batch.update(ref, { revoked: true });
      });

      await batch.commit();
    }

    return res.json({
      success: true,
      currentSessionId: req.applicationSession.sessionId,
      sessions,
    });
  } catch (error) {
    console.error("List sessions error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve active sessions.",
    });
  }
});

// Revoke a selected session owned by the current user.
app.delete("/api/session/:sessionId", verifyUser, async (req, res) => {
  try {
    const sessionRef = db
      .collection(SESSION_COLLECTION)
      .doc(req.params.sessionId);

    const snapshot = await sessionRef.get();

    if (
      !snapshot.exists ||
      snapshot.data().uid !== req.user.uid
    ) {
      return res.status(404).json({
        message: "Session not found.",
      });
    }

    await sessionRef.update({
      revoked: true,
    });

    const isCurrent =
      req.params.sessionId === req.applicationSession.sessionId;

    return res.json({
      success: true,
      currentSession: isCurrent,
      message: "Session revoked successfully.",
    });
  } catch (error) {
    console.error("Revoke session error:", error.message);

    return res.status(500).json({
      message: "Unable to revoke this session.",
    });
  }
});

// Revoke every session belonging to the current user.
app.post("/api/session/logout-all", verifyUser, async (req, res) => {
  try {
    const snapshot = await db
      .collection(SESSION_COLLECTION)
      .where("uid", "==", req.user.uid)
      .get();

    // Keep each Firestore batch below the 500-write limit.
    for (let i = 0; i < snapshot.docs.length; i += 450) {
      const batch = db.batch();

      snapshot.docs.slice(i, i + 450).forEach(document => {
        batch.update(document.ref, {
          revoked: true,
        });
      });

      await batch.commit();
    }

    // Revoke Firebase refresh tokens for all devices.
    await auth.revokeRefreshTokens(req.user.uid);

    return res.json({
      success: true,
      message: "All sessions have been logged out.",
    });
  } catch (error) {
    console.error("Logout all sessions error:", error.message);

    return res.status(500).json({
      message: "Unable to log out all sessions.",
    });
  }
});

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "DEV@Deakin backend is running.",
  });
});

// --------------------------------------------------
// CREATE POST
// --------------------------------------------------

app.post(
  "/api/posts",
  verifyUser,
  verifyUserPlan,
  async (req, res) => {
    try {
      const validationError = validatePost(req.body || {});

      if (validationError) {
        return res.status(400).json({
          message: validationError,
        });
      }

      const {
        type,
        plan,
        title,
        tags,
        description,
        abstract,
        articleText,
      } = req.body;

      if (
        plan === "paid" &&
        req.userProfile.plan !== "paid"
      ) {
        return res.status(403).json({
          message: "Upgrade to the Paid plan to publish Paid posts.",
        });
      }

      const postData = {
        type,
        plan,
        title: title.trim(),
        tags: tags.map(tag => tag.trim().toLowerCase()),
        authorId: req.user.uid,
        authorName:
          req.userProfile.fullName ||
          req.user.name ||
          "DEV@Deakin User",
        createdAt: FieldValue.serverTimestamp(),
      };

      if (type === "Question") {
        postData.description = description.trim();
      }

      if (type === "Article") {
        postData.abstract = abstract.trim();
        postData.articleText = articleText.trim();
      }

      const postRef = await db
        .collection("posts")
        .add(postData);

      console.log("Post created:", postRef.id);

      return res.status(201).json({
        success: true,
        message: "Post published successfully!",
        postId: postRef.id,
      });
    } catch (error) {
      console.error("Post creation error:", error);

      return res.status(500).json({
        message: "Unable to publish your post.",
      });
    }
  }
);

// --------------------------------------------------
// BROWSE POSTS
// --------------------------------------------------

app.get("/api/posts", optionalAuth, async (req, res) => {
  try {
    const { type, plan, tag, from, to } = req.query;
    const userPlan = req.subscriptionPlan;

    if (type && !["Question", "Article"].includes(type)) {
      return res.status(400).json({
        message: "Invalid post type filter.",
      });
    }

    if (plan && !["free", "paid"].includes(plan)) {
      return res.status(400).json({
        message: "Invalid post plan filter.",
      });
    }

    if (
      tag &&
      (typeof tag !== "string" || tag.trim().length > 30)
    ) {
      return res.status(400).json({
        message: "Invalid tag filter.",
      });
    }

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    if (
      (from && Number.isNaN(fromDate.getTime())) ||
      (to && Number.isNaN(toDate.getTime()))
    ) {
      return res.status(400).json({
        message: "Invalid date filter.",
      });
    }

    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({
        message: "Start date cannot be after end date.",
      });
    }

    const snapshot = await db
      .collection("posts")
      .get();

    let posts = snapshot.docs.map(document => ({
      id: document.id,
      ...document.data(),
    }));

    // Restrict access before applying the other filters.
    if (userPlan === "free") {
      posts = posts.filter(post => post.plan === "free");
    }

    if (type) {
      posts = posts.filter(post => post.type === type);
    }

    if (plan) {
      posts = posts.filter(post => post.plan === plan);
    }

    if (tag) {
      const searchTag = tag.trim().toLowerCase();

      posts = posts.filter(
        post =>
          Array.isArray(post.tags) &&
          post.tags.includes(searchTag)
      );
    }

    if (fromDate) {
      posts = posts.filter(post => {
        const date = post.createdAt?.toDate?.();
        return date && date >= fromDate;
      });
    }

    if (toDate) {
      posts = posts.filter(post => {
        const date = post.createdAt?.toDate?.();
        return date && date <= toDate;
      });
    }

    posts.sort((a, b) => {
      const dateA = a.createdAt?.toMillis?.() || 0;
      const dateB = b.createdAt?.toMillis?.() || 0;

      return dateB - dateA;
    });

    const formattedPosts = posts.map(post => ({
      ...post,
      createdAt: post.createdAt?.toDate
        ? post.createdAt.toDate().toISOString()
        : null,
    }));

    return res.status(200).json({
      success: true,
      userPlan,
      totalPosts: formattedPosts.length,
      posts: formattedPosts,
    });
  } catch (error) {
    console.error("Browse posts error:", error);

    return res.status(500).json({
      message: "Unable to retrieve posts.",
    });
  }
});

// --------------------------------------------------
// NEWSLETTER SUBSCRIPTION
// --------------------------------------------------

app.post("/subscribe", async (req, res) => {
  try {
    if (
      !process.env.SENDGRID_API_KEY ||
      !process.env.SENDGRID_FROM_EMAIL
    ) {
      return res.status(503).json({
        message: "Newsletter service is not configured.",
      });
    }

    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim()
        : "";

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !emailPattern.test(email)) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    await sgMail.send({
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: "Welcome to DEV@Deakin!",
      text: "Thank you for subscribing to the DEV@Deakin Daily Insider!",
      html: `
        <h1>Welcome to DEV@Deakin!</h1>
        <p>Thank you for subscribing to our Daily Insider.</p>
        <p>We are excited to have you with us!</p>
      `,
    });

    return res.status(202).json({
      message: "Subscription successful! Check your inbox.",
    });
  } catch (error) {
    console.error(
      "SendGrid error:",
      error.response?.body || error.message
    );

    return res.status(500).json({
      message: "Unable to send the welcome email.",
    });
  }
});

// --------------------------------------------------
// GLOBAL ERROR HANDLER
// --------------------------------------------------

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      message: "Invalid JSON request.",
    });
  }

  console.error("Server error:", error.message);

  return res.status(500).json({
    message: "An unexpected server error occurred.",
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
