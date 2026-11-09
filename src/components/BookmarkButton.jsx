
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { Bookmark } from "lucide-react";

import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import "../pages/ReadingLists.css";

function BookmarkButton({ post }) {
  const { currentUser } = useAuth();

  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!currentUser || !post?.id) {
      setSaved(false);
      return;
    }

    const bookmarkRef = doc(
      db,
      "userBookmarks",
      currentUser.uid,
      "items",
      post.id
    );

    const unsubscribe = onSnapshot(
      bookmarkRef,
      (snapshot) => setSaved(snapshot.exists()),
      (err) => {
        console.error("Bookmark listener error:", err);
        setError("Unable to check bookmark status.");
      }
    );

    return unsubscribe;
  }, [currentUser, post?.id]);

  const toggleBookmark = async () => {
    if (!currentUser || !post?.id || loading) return;

    setLoading(true);
    setError("");

    const bookmarkRef = doc(
      db,
      "userBookmarks",
      currentUser.uid,
      "items",
      post.id
    );

    try {
      if (saved) {
        await deleteDoc(bookmarkRef);
      } else {
        const savedPost = {
          id: post.id,
          type: post.type || "Article",
          plan: post.plan || "free",
          title: post.title || "Untitled",
          description: post.description || "",
          abstract: post.abstract || "",
          articleText: post.articleText || "",
          tags: Array.isArray(post.tags) ? post.tags : [],
          authorName: post.authorName || "Community Member",
          authorId: post.authorId || "",
          createdAt: post.createdAt || null,
          savedAt: serverTimestamp(),
        };

        await setDoc(bookmarkRef, savedPost);
      }
    } catch (err) {
      console.error("Bookmark update error:", err);
      setError("Unable to update bookmark. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <Link to="/login" className="bookmark-login-link">
        Login to bookmark
      </Link>
    );
  }

  return (
    <div className="bookmark-control">
      <button
        type="button"
        className={`bookmark-button ${saved ? "is-saved" : ""}`}
        onClick={toggleBookmark}
        disabled={loading}
        aria-pressed={saved}
        title={saved ? "Remove bookmark" : "Save bookmark"}
      >
        <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
        {loading
          ? "Updating..."
          : saved
            ? "Saved"
            : "Save"}
      </button>

      {error && <small className="bookmark-error">{error}</small>}
    </div>
  );
}

export default BookmarkButton;
