
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  Bookmark,
  BookmarkX,
  BookOpen,
  FolderPlus,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";

import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import "./ReadingLists.css";

function ReadingLists() {
  const { currentUser, loading: authLoading } = useAuth();

  const [bookmarks, setBookmarks] = useState([]);
  const [lists, setLists] = useState([]);

  const [listName, setListName] = useState("");
  const [selectedLists, setSelectedLists] = useState({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!currentUser) {
      setBookmarks([]);
      setLists([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const bookmarksRef = collection(
      db,
      "userBookmarks",
      currentUser.uid,
      "items"
    );

    const listsRef = collection(
      db,
      "userReadingLists",
      currentUser.uid,
      "lists"
    );

    let bookmarksLoaded = false;
    let listsLoaded = false;

    const finishLoading = () => {
      if (bookmarksLoaded && listsLoaded) {
        setLoading(false);
      }
    };

    const unsubscribeBookmarks = onSnapshot(
      bookmarksRef,
      (snapshot) => {
        setBookmarks(
          snapshot.docs
            .map((item) => ({
              ...item.data(),
              id: item.id,
            }))
            .sort((a, b) => {
              const dateA = a.savedAt?.toMillis?.() || 0;
              const dateB = b.savedAt?.toMillis?.() || 0;
              return dateB - dateA;
            })
        );

        bookmarksLoaded = true;
        finishLoading();
      },
      (err) => {
        console.error("Bookmarks loading error:", err);
        setError("Unable to load your saved posts.");
        setLoading(false);
      }
    );

    const unsubscribeLists = onSnapshot(
      listsRef,
      (snapshot) => {
        setLists(
          snapshot.docs
            .map((item) => ({
              ...item.data(),
              id: item.id,
            }))
            .sort((a, b) => {
              const dateA = a.createdAt?.toMillis?.() || 0;
              const dateB = b.createdAt?.toMillis?.() || 0;
              return dateB - dateA;
            })
        );

        listsLoaded = true;
        finishLoading();
      },
      (err) => {
        console.error("Reading lists loading error:", err);
        setError("Unable to load your reading lists.");
        setLoading(false);
      }
    );

    return () => {
      unsubscribeBookmarks();
      unsubscribeLists();
    };
  }, [currentUser]);

  const bookmarkMap = useMemo(
    () => new Map(bookmarks.map((post) => [post.id, post])),
    [bookmarks]
  );

  const createReadingList = async (event) => {
    event.preventDefault();

    const cleanName = listName.trim();

    if (!cleanName) return;

    if (cleanName.length > 50) {
      setError("List name cannot exceed 50 characters.");
      return;
    }

    if (
      lists.some(
        (list) => list.name.toLowerCase() === cleanName.toLowerCase()
      )
    ) {
      setError("A reading list with this name already exists.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await addDoc(
        collection(db, "userReadingLists", currentUser.uid, "lists"),
        {
          name: cleanName,
          postIds: [],
          createdAt: serverTimestamp(),
        }
      );

      setListName("");
      setMessage("Reading list created successfully.");
    } catch (err) {
      console.error("Create list error:", err);
      setError("Unable to create reading list.");
    } finally {
      setSaving(false);
    }
  };

  const addPostToList = async (postId) => {
    const listId = selectedLists[postId];

    if (!listId) {
      setError("Please select a reading list first.");
      return;
    }

    setError("");
    setMessage("");

    try {
      const listRef = doc(
        db,
        "userReadingLists",
        currentUser.uid,
        "lists",
        listId
      );

      await updateDoc(listRef, {
        postIds: arrayUnion(postId),
      });

      setMessage("Post added to your reading list.");
    } catch (err) {
      console.error("Add to list error:", err);
      setError("Unable to add this post to the selected list.");
    }
  };

  const removePostFromList = async (listId, postId) => {
    try {
      const listRef = doc(
        db,
        "userReadingLists",
        currentUser.uid,
        "lists",
        listId
      );

      await updateDoc(listRef, {
        postIds: arrayRemove(postId),
      });

      setMessage("Post removed from reading list.");
      setError("");
    } catch (err) {
      console.error("Remove from list error:", err);
      setError("Unable to remove this post.");
    }
  };

  const removeBookmark = async (postId) => {
    try {
      await deleteDoc(
        doc(
          db,
          "userBookmarks",
          currentUser.uid,
          "items",
          postId
        )
      );

      // The post is also removed from every list to prevent stale entries.
      const removals = lists
        .filter((list) => (list.postIds || []).includes(postId))
        .map((list) =>
          updateDoc(
            doc(
              db,
              "userReadingLists",
              currentUser.uid,
              "lists",
              list.id
            ),
            { postIds: arrayRemove(postId) }
          )
        );

      await Promise.all(removals);

      setMessage("Bookmark removed.");
      setError("");
    } catch (err) {
      console.error("Remove bookmark error:", err);
      setError("Unable to remove this bookmark.");
    }
  };

  const deleteReadingList = async (listId) => {
    const confirmed = window.confirm(
      "Delete this reading list? Your bookmarked posts will not be deleted."
    );

    if (!confirmed) return;

    try {
      await deleteDoc(
        doc(
          db,
          "userReadingLists",
          currentUser.uid,
          "lists",
          listId
        )
      );

      setMessage("Reading list deleted.");
      setError("");
    } catch (err) {
      console.error("Delete list error:", err);
      setError("Unable to delete this reading list.");
    }
  };

  const formatDate = (value) => {
    if (!value) return "Date unavailable";

    const date =
      typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Date unavailable";
    }

    return date.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  if (authLoading) {
    return (
      <main className="reading-page">
        <p>Checking your account...</p>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="reading-page">
        <div className="reading-empty">
          <Bookmark size={38} />
          <h2>Log in to save posts</h2>
          <p>
            Sign in to bookmark community posts and create your own
            reading lists.
          </p>
          <Link to="/login" className="reading-primary-link">
            Log In
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="reading-page">
      <section className="reading-heading">
        <p className="reading-eyebrow">Your Personal Library</p>
        <h1>Bookmarks & Reading Lists</h1>
        <p>
          Keep useful community posts organised and ready to read later.
        </p>

        <div className="reading-stats">
          <div>
            <Bookmark size={20} />
            <span>
              <strong>{bookmarks.length}</strong>
              Saved Posts
            </span>
          </div>

          <div>
            <BookOpen size={20} />
            <span>
              <strong>{lists.length}</strong>
              Reading Lists
            </span>
          </div>
        </div>
      </section>

      <section className="create-list-section">
        <div>
          <FolderPlus size={23} />
          <div>
            <h2>Create a Reading List</h2>
            <p>Group saved posts by topic or learning goal.</p>
          </div>
        </div>

        <form onSubmit={createReadingList}>
          <input
            type="text"
            value={listName}
            onChange={(event) => setListName(event.target.value)}
            placeholder="e.g. React Learning"
            maxLength={50}
            required
          />

          <button type="submit" disabled={saving}>
            {saving ? "Creating..." : "Create List"}
          </button>
        </form>
      </section>

      {error && (
        <p className="reading-notice error" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="reading-notice success" role="status">
          {message}
        </p>
      )}

      {loading ? (
        <p className="reading-loading">Loading your library...</p>
      ) : (
        <>
          <section className="saved-posts-section">
            <div className="reading-section-heading">
              <div>
                <p className="reading-eyebrow">Your Collection</p>
                <h2>Saved Posts</h2>
              </div>
              <span>{bookmarks.length} saved</span>
            </div>

            {bookmarks.length === 0 ? (
              <div className="reading-empty">
                <Bookmark size={34} />
                <h3>No bookmarks yet</h3>
                <p>
                  Visit Browse Posts and select Save on a post to add
                  it to your library.
                </p>
                <Link to="/browse-posts" className="reading-primary-link">
                  Browse Posts
                </Link>
              </div>
            ) : (
              <div className="saved-post-grid">
                {bookmarks.map((post) => (
                  <article className="saved-post-card" key={post.id}>
                    <div className="saved-post-top">
                      <span>{post.type || "Post"}</span>
                      <button
                        type="button"
                        className="icon-action danger"
                        onClick={() => removeBookmark(post.id)}
                        title="Remove bookmark"
                        aria-label={`Remove bookmark for ${post.title}`}
                      >
                        <BookmarkX size={18} />
                      </button>
                    </div>

                    <h3>{post.title}</h3>

                    <p className="saved-post-author">
                      By {post.authorName || "Community Member"}
                    </p>

                    <p className="saved-post-description">
                      {post.abstract ||
                        post.description ||
                        "No description available."}
                    </p>

                    <div className="saved-post-footer">
                      <span>{formatDate(post.createdAt)}</span>
                    </div>

                    <div className="add-to-list-control">
                      <select
                        value={selectedLists[post.id] || ""}
                        onChange={(event) =>
                          setSelectedLists((previous) => ({
                            ...previous,
                            [post.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Choose a reading list</option>
                        {lists.map((list) => (
                          <option key={list.id} value={list.id}>
                            {list.name}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => addPostToList(post.id)}
                        disabled={lists.length === 0}
                      >
                        Add
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="reading-lists-section">
            <div className="reading-section-heading">
              <div>
                <p className="reading-eyebrow">Organise Your Learning</p>
                <h2>My Reading Lists</h2>
              </div>
              <span>{lists.length} lists</span>
            </div>

            {lists.length === 0 ? (
              <div className="reading-empty compact">
                <BookOpen size={32} />
                <h3>No reading lists created</h3>
                <p>Create your first list using the form above.</p>
              </div>
            ) : (
              <div className="reading-list-grid">
                {lists.map((list) => {
                  const listPosts = (list.postIds || [])
                    .map((postId) => bookmarkMap.get(postId))
                    .filter(Boolean);

                  return (
                    <article className="reading-list-card" key={list.id}>
                      <div className="reading-list-card-heading">
                        <div className="reading-list-icon">
                          <BookOpen size={21} />
                        </div>

                        <button
                          type="button"
                          className="icon-action danger"
                          onClick={() => deleteReadingList(list.id)}
                          title="Delete reading list"
                          aria-label={`Delete ${list.name}`}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>

                      <h3>{list.name}</h3>

                      <p className="reading-list-count">
                        {listPosts.length} saved{" "}
                        {listPosts.length === 1 ? "post" : "posts"}
                      </p>

                      {listPosts.length === 0 ? (
                        <p className="reading-list-empty">
                          This list is empty. Add posts from your Saved Posts.
                        </p>
                      ) : (
                        <div className="reading-list-items">
                          {listPosts.map((post) => (
                            <div
                              className="reading-list-item"
                              key={post.id}
                            >
                              <span>{post.title}</span>

                              <button
                                type="button"
                                onClick={() =>
                                  removePostFromList(list.id, post.id)
                                }
                                aria-label={`Remove ${post.title} from ${list.name}`}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default ReadingLists;
