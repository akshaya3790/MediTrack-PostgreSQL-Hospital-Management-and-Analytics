import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Redirect, useLocation } from 'react-router-dom';
import { SESSION_EXPIRED, api } from './api';
import { Spinner, useToast } from './components/ui';

// Who is logged in: { email, who: 'pat' | 'doc', name }, or null for a visitor.
// The login itself lives in an HttpOnly cookie that scripts cannot read; the app only
// asks the server who the cookie belongs to.
const AuthContext = createContext(null);

const HOMES = { pat: '/patient', doc: '/doctor', adm: '/admin' };
export const homeFor = user => (user && HOMES[user.who]) || '/patient';

export function AuthProvider({ children }) {
  const notify = useToast();
  const [user, setUser] = useState(undefined);

  const refresh = useCallback(() => api('/auth/me')
    .then(res => setUser(res.email ? res : null))
    .catch(() => setUser(null)), []);

  useEffect(() => { refresh(); }, [refresh]);

  // The server ended the session (expired or signed out elsewhere)
  useEffect(() => {
    const onExpired = () => setUser(current => {
      if (current) notify('Your session has ended. Please sign in again.', 'error');
      return null;
    });
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, [notify]);

  const logout = useCallback(() => api('/auth/logout', { method: 'POST' })
    .catch(() => {})
    .then(() => setUser(null)), []);

  // Wait for the session check before showing any page, so a signed-in user
  // never sees the sign-in page flash up
  if (user === undefined) return <Spinner full />;

  return (
    <AuthContext.Provider value={{ user, setUser, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// Shows children only to a logged-in user with the given role; sends others to sign in
// or to their own dashboard. The server checks the same rules on every API call.
export function RequireRole({ role, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    // Remember the page (with its query string) so sign-in can return to it
    const loginPath = role === 'adm' ? '/admin/login' : '/login';
    return <Redirect to={{ pathname: loginPath, state: { from: location.pathname + location.search } }} />;
  }
  if (role && user.who !== role) return <Redirect to={homeFor(user)} />;
  return children;
}
