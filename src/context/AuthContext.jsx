
import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { onIdTokenChanged } from "firebase/auth";
import { auth } from "../firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(
      auth,
      async (user) => {
        if (!user) {
          setCurrentUser(null);
          setLoading(false);
          return;
        }

        try {
          const tokenResult =
            await user.getIdTokenResult();

          if (
            tokenResult.claims.mfaVerified === true
          ) {
            setCurrentUser(user);
          } else {
            // Password authentication alone is not
            // sufficient for application access.
            setCurrentUser(null);
          }

        } catch (error) {
          console.error(
            "Authentication verification error:",
            error
          );

          setCurrentUser(null);

        } finally {
          setLoading(false);
        }
      }
    );

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
