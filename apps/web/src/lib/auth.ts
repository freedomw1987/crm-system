import { create } from 'zustand';
import { authApi, setToken, getToken, type AuthUser } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  bootstrapped: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  bootstrap: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: false,
  bootstrapped: false,

  async login(email, password) {
    set({ loading: true });
    try {
      const { token, user } = await authApi.login(email, password);
      setToken(token);
      set({ user, loading: false });
      return user;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  logout() {
    setToken(null);
    set({ user: null });
  },

  async bootstrap() {
    if (!getToken()) {
      set({ bootstrapped: true });
      return;
    }
    try {
      const user = await authApi.me();
      set({ user, bootstrapped: true });
    } catch {
      setToken(null);
      set({ user: null, bootstrapped: true });
    }
  },
}));
