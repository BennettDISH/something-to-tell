import { createContext, useContext, useState, useEffect } from 'react';
import { getProfile, login as loginApi, register as registerApi, ssoCallback, clearToken, getToken } from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (getToken()) {
      getProfile().then(setUser).catch(() => clearToken()).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const u = await loginApi(email, password);
    setUser(u);
    return u;
  };

  const register = async (fields) => {
    const u = await registerApi(fields);
    setUser(u);
    return u;
  };

  const ssoLogin = async (code) => {
    const u = await ssoCallback(code);
    setUser(u);
    return u;
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, ssoLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
