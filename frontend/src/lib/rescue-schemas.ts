import { z } from "zod";

export const donationSchema = z.object({
  title: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  pounds: z.coerce.number().positive().max(100000),
  pickupAddress: z.string().trim().min(5).max(240),
  pickupDeadline: z.string().datetime(),
  storageRequired: z.enum(["ambient", "refrigerated", "frozen"]),
  allergens: z.string().trim().max(500),
  notes: z.string().trim().max(1000),
});

export const onboardingSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  role: z.enum(["donor", "recipient", "driver", "coordinator"]),
  organizationId: z.string().uuid().optional(),
}).superRefine((input, ctx) => {
  const needsOrganization = input.role === "donor" || input.role === "recipient";
  if (needsOrganization && !input.organizationId) {
    ctx.addIssue({ code: "custom", path: ["organizationId"], message: "Choose your organization" });
  }
  if (!needsOrganization && input.organizationId) {
    ctx.addIssue({ code: "custom", path: ["organizationId"], message: "This role does not join an organization" });
  }
});

export const membershipRequestIdSchema = z.object({
  requestId: z.string().uuid(),
});
