import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiWorkflows } from '@/components/rescuerelay/ai-workflows';

const mockData = {
  donations: [
    {
      id: 'd-1',
      title: 'Prepared refrigerated meals',
      pounds: 150,
      category: 'prepared meals',
      pickup_address: '100 E Grand Ave, Des Moines, IA',
      pickup_deadline: new Date(Date.now() + 3600000).toISOString(),
      storage_required: 'refrigerated',
      allergens: 'Dairy',
      status: 'open',
    },
  ],
  organizations: [
    {
      id: 'org-1',
      name: 'Hope Community Pantry',
      type: 'recipient',
      address: '1200 Grand Ave, Des Moines, IA',
      capacity_lbs: 1000,
      accepted_categories: ['prepared meals'],
      verification_status: 'verified',
    },
  ],
  roles: [{ role: 'recipient' }],
};

describe('AiWorkflows Component', () => {
  it('renders AI Social & Broadcast Workflows title and active metrics', () => {
    render(<AiWorkflows data={mockData} role="recipient" />);

    expect(screen.getByText('AI Social & Broadcast Workflows')).toBeInTheDocument();
    expect(screen.getByText('Built-In Distribution AI Agents')).toBeInTheDocument();
    expect(screen.getByText('Community Food Alert Agent')).toBeInTheDocument();
    expect(screen.getByText('Urgent Surplus Alert Bot')).toBeInTheDocument();
    expect(screen.getByText('Sister Pantry & Shelter Dispatcher')).toBeInTheDocument();
  });

  it('renders without error even when localStorage contains JSON serialized agents with missing icon functions', () => {
    localStorage.setItem(
      'rr_ai_agents',
      JSON.stringify([
        {
          id: 'community-alert',
          name: 'Community Food Alert Agent',
          role: 'Public distribution announcements',
          description: 'Custom description',
          enabled: true,
          tone: 'community',
          channels: ['Google Maps'],
          autoPublish: false,
          signoff: 'Test signoff',
        },
      ])
    );

    render(<AiWorkflows data={mockData} role="coordinator" />);
    expect(screen.getByText('Community Food Alert Agent')).toBeInTheDocument();
    localStorage.removeItem('rr_ai_agents');
  });

  it('handles empty donations gracefully without crashing', () => {
    const emptyData = { donations: [], organizations: [], roles: [{ role: 'donor' }] };
    render(<AiWorkflows data={emptyData} role="donor" />);
    expect(screen.getByText('AI Social & Broadcast Workflows')).toBeInTheDocument();
  });

  it('displays the Mistral AI MCP badge in the header', () => {
    render(<AiWorkflows data={mockData} role="coordinator" />);
    expect(screen.getByText('Mistral AI MCP')).toBeInTheDocument();
  });
});

describe('Mistral MCP & Social Connectors Library', () => {
  it('testSocialConnection reports diagnostics, and reports ok=false when the MCP server is unreachable', async () => {
    const { testSocialConnection } = await import('@/lib/social-agents');
    for (const platform of ['facebook', 'instagram', 'linkedin', 'x', 'google_business']) {
      const res = await testSocialConnection(platform, {
        handle: `@test_${platform}`,
      });
      // No MCP server is reachable under test, so the connection must not be
      // reported as verified — that claim is only true for a live handshake.
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/simulated/i);
      expect(res.platform).toBe(platform);
      expect(res.latencyMs).toBeGreaterThan(0);
      expect(res.scopes).toContain('posts.write');
    }
  });

  it('generateWithMistralAi produces compliant broadcast copy with meal estimates', async () => {
    const { generateWithMistralAi } = await import('@/lib/social-agents');
    const res = await generateWithMistralAi({
      platform: 'facebook',
      pounds: 150,
      category: 'prepared meals',
      pickupAddress: '1200 Grand Ave, Des Moines',
      deadline: '3:00 PM',
    });

    expect(res.content).toBeTruthy();
    expect(res.charCount).toBeGreaterThan(50);
    expect(res.content).toContain('150');
    expect(res.content).toContain('meals');
    expect(res.model).toContain('mistral');
  });

  it('auditDraftWithMistral detects allergen notices and returns high compliance', async () => {
    const { auditDraftWithMistral } = await import('@/lib/social-agents');
    const goodDraft = 'Fresh refrigerated meals at 1200 Grand Ave! Allergen notice: contains Dairy. Pickup open until 3 PM.';
    const res = await auditDraftWithMistral({
      content: goodDraft,
      platform: 'facebook',
      allergens: 'Dairy',
    });

    expect(res.auditPassed).toBe(true);
    expect(res.complianceScore).toBeGreaterThanOrEqual(90);
  });

  it('keeps social connection metadata without persisting access tokens', async () => {
    const { saveSocialCredentials, getSocialCredentials, disconnectSocialAccount } = await import('@/lib/social-agents');
    saveSocialCredentials('facebook', {
      pageId: '1029384756',
      handle: '@HopeCommunityPantry',
    });

    const saved = getSocialCredentials('facebook');
    expect(saved?.pageId).toBe('1029384756');
    expect(saved?.verified).toBe(true);
    expect(localStorage.getItem('rr_social_creds_facebook')).toBeNull();

    disconnectSocialAccount('facebook');
    const cleared = getSocialCredentials('facebook');
    expect(cleared).toBeNull();
  });
});
