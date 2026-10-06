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
});

