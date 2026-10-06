import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { AuthContext, usePartnerAuth, type AuthContextType } from "@/lib/auth-context";

describe("Realtime Supabase Auth state synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provides complete real-time auth context attributes", () => {
    const mockSignOut = vi.fn();
    const mockRefreshProfile = vi.fn();

    const mockValue: AuthContextType = {
      user: {
        id: "usr-456",
        app_metadata: {},
        user_metadata: { full_name: "Test Coordinator" },
        aud: "authenticated",
        created_at: new Date().toISOString(),
      } as any,
      session: {
        access_token: "jwt-token-xyz",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "refresh-xyz",
        user: { id: "usr-456" } as any,
      } as any,
      profile: {
        id: "usr-456",
        full_name: "Test Coordinator",
        phone: "515-555-0199",
        food_safety_training: true,
        vehicle_capacity_lbs: 500,
        availability: true,
        onboarding_complete: true,
        organization_id: "org-1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      roles: ["coordinator", "driver"],
      roleRows: [
        { id: "r1", user_id: "usr-456", role: "coordinator" },
        { id: "r2", user_id: "usr-456", role: "driver" },
      ],
      loading: false,
      recovery: false,
      refreshProfile: mockRefreshProfile,
      signOut: mockSignOut,
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthContext.Provider value={mockValue}>{children}</AuthContext.Provider>
    );

    const { result } = renderHook(() => usePartnerAuth(), { wrapper });

    expect(result.current.user?.id).toBe("usr-456");
    expect(result.current.session?.access_token).toBe("jwt-token-xyz");
    expect(result.current.profile?.full_name).toBe("Test Coordinator");
    expect(result.current.roles).toEqual(["coordinator", "driver"]);
    expect(result.current.loading).toBe(false);
    expect(result.current.recovery).toBe(false);
  });

  it("handles unauthenticated state defaults cleanly", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthContext.Provider
        value={{
          user: null,
          session: null,
          profile: null,
          roles: [],
          roleRows: [],
          loading: false,
          recovery: false,
          refreshProfile: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        {children}
      </AuthContext.Provider>
    );

    const { result } = renderHook(() => usePartnerAuth(), { wrapper });

    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.roles).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
