import { describe, expect, it } from 'vitest';
import { donationSchema, onboardingSchema } from '@/lib/rescue-schemas';

describe('Rescue input validation', () => {
 const donation = {title:'Prepared meals',category:'prepared meals',pounds:150,pickupAddress:'400 E Locust St, Des Moines, IA',pickupDeadline:'2026-10-07T18:00:00Z',storageRequired:'refrigerated',allergens:'Dairy',notes:'Keep cold'};
 it('accepts complete donation details',()=>expect(donationSchema.safeParse(donation).success).toBe(true));
 it('rejects zero weight and invalid storage',()=>{
  expect(donationSchema.safeParse({...donation,pounds:0}).success).toBe(false);
  expect(donationSchema.safeParse({...donation,storageRequired:'uncontrolled'}).success).toBe(false);
 });
 it('restricts onboarding to operational roles',()=>{
  expect(onboardingSchema.safeParse({fullName:'Jordan Lee',role:'driver'}).success).toBe(true);
  expect(onboardingSchema.safeParse({fullName:'Jordan Lee',role:'admin'}).success).toBe(false);
  expect(onboardingSchema.safeParse({fullName:'Jordan Lee',role:'coordinator'}).success).toBe(false);
 });
});
