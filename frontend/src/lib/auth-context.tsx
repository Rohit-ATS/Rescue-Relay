import { createContext, useContext } from 'react';
import type { User } from '@supabase/supabase-js';

export const AuthContext = createContext<{ user: User | null; loading: boolean; recovery: boolean }>({ user: null, loading: true, recovery: false });
export const usePartnerAuth = () => useContext(AuthContext);