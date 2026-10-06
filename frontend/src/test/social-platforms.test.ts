import { describe, expect, it } from 'vitest';
import {
  PLATFORM_SPECS,
  validateForPlatform,
  countHashtags,
  platformLength,
} from '../../supabase/functions/_shared/social/platforms';
import {
  AGENT_DEFINITIONS,
  checkDraft,
  estimateMeals,
  templateDraft,
} from '../../supabase/functions/_shared/social/agents';

describe('Social Platforms & MCP Constraints', () => {
  it('enforces character limits for LinkedIn, Instagram, X, and Google Maps', () => {
    expect(PLATFORM_SPECS.linkedin.maxChars).toBe(3000);
    expect(PLATFORM_SPECS.instagram.maxChars).toBe(2200);
    expect(PLATFORM_SPECS.x.maxChars).toBe(280);
    expect(PLATFORM_SPECS.google_business.maxChars).toBe(1500);
  });

  it('validates X character limits accurately', () => {
    const validTweet = 'Fresh food distribution today at Hope Pantry! 100 lbs available.';
    const validRes = validateForPlatform('x', validTweet);
    expect(validRes.ok).toBe(true);
    expect(validRes.errors).toHaveLength(0);

    const longTweet = 'A'.repeat(290);
    const longRes = validateForPlatform('x', longTweet);
    expect(longRes.ok).toBe(false);
    expect(longRes.errors[0]).toContain('allows 280 characters');
  });

  it('requires an image URL for Instagram feed posts', () => {
    const withoutImg = validateForPlatform('instagram', 'Food arrives today!');
    expect(withoutImg.ok).toBe(false);
    expect(withoutImg.errors[0]).toContain('posts need an image');

    const withImg = validateForPlatform('instagram', 'Food arrives today!', { imageUrl: 'https://example.com/card.png' });
    expect(withImg.ok).toBe(true);
  });

  it('counts hashtags and issues warning when excessive', () => {
    const text = 'Hello #food #rescue #zerowaste #desmoines';
    expect(countHashtags(text)).toBe(4);

    const xVal = validateForPlatform('x', text);
    expect(xVal.warnings[0]).toContain('works best with 3 or fewer');
  });
});

describe('AI Agents & Food Safety Guardrails', () => {
  const mockRescue = {
    id: 'r-1',
    title: 'Surplus Deli Sandwiches',
    category: 'prepared meals',
    pounds: 150,
    pickupAddress: '100 E Grand Ave',
    pickupDeadline: new Date(Date.now() + 7200000).toISOString(),
    storage: 'refrigerated',
    allergens: 'Dairy, Wheat',
    notes: 'Keep chilled',
    status: 'open',
  };

  const mockOrg = {
    name: 'Hope Community Pantry',
    address: '1200 Grand Ave',
  };

  it('calculates meal impact accurately based on USDA standard (~1.2 lb)', () => {
    expect(estimateMeals(120)).toBe(100);
    expect(estimateMeals(150)).toBe(125);
  });

  it('generates compliant fallback template drafts', () => {
    const draft = templateDraft('community-alert', 'x', mockRescue, mockOrg);
    expect(draft).toContain('150 lb');
    expect(draft).toContain('refrigerated');
    expect(platformLength('x', draft)).toBeLessThanOrEqual(280);
  });

  it('detects mismatched weight in AI drafts', () => {
    const agent = AGENT_DEFINITIONS['community-alert'];
    const badDraft = {
      platform: 'google_business' as const,
      content: 'We have 500 lbs of food available today! Keep refrigerated. Allergens: Dairy, Wheat.',
    };

    const guard = checkDraft(badDraft, { agent, rescue: mockRescue });
    expect(guard.ok).toBe(false);
    expect(guard.problems[0]).toContain('Mentions 500 lb but the rescue record says 150 lb');
  });

  it('flags missing allergen disclosures on public food posts', () => {
    const agent = AGENT_DEFINITIONS['community-alert'];
    const draftWithoutAllergens = {
      platform: 'google_business' as const,
      content: 'We have 150 lbs of fresh food today! Keep refrigerated.',
    };

    const guard = checkDraft(draftWithoutAllergens, { agent, rescue: mockRescue });
    expect(guard.ok).toBe(false);
    expect(guard.problems[0]).toContain('Allergens not mentioned');
  });
});

