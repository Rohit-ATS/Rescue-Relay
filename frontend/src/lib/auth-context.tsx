import { createContext, useContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export type UserProfile = Database['public']['Tables']['profiles']['Row'];
export type UserRoleRow = Database['public']['Tables']['user_roles']['Row'];
export type AppRole = Database['public']['Enums']['app_role'];

export type AuthContextType = {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  roles: AppRole[];
  roleRows: UserRoleRow[];
  loading: boolean;
  recovery: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  roles: [],
  roleRows: [],
  loading: true,
  recovery: false,
  refreshProfile: async () => {},
  signOut: async () => {},
});

export const usePartnerAuth = () => useContext(AuthContext);