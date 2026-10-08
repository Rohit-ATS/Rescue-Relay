-- RescueRelay demo data
-- ---------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL Editor and run it. It runs as the
-- postgres role, so row-level security does not apply and no API keys are needed.
--
-- Safe to re-run: every row it owns is keyed to a fixed UUID block and deleted
-- before being re-inserted. It touches nothing outside that block.
--
-- Organization names are fictional, placed at real Des Moines street addresses so
-- distances, sorting and driving routes behave realistically. No real nonprofit is
-- represented here.
--
-- Deadlines are relative to the moment you run it, so the demo is always current.
-- ---------------------------------------------------------------------------

BEGIN;

-- ===========================================================================
-- 1. Demo fixture identities.
-- ===========================================================================
-- These identities make the seeded foreign keys realistic, but are not shared
-- sign-in accounts. New rows receive an undisclosed random password and existing
-- rows are left alone, so re-running the fixture never resets an account password.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  demo RECORD;
BEGIN
  FOR demo IN
    SELECT * FROM (VALUES
      ('d0000000-0000-4000-a000-000000000001'::uuid, 'donor@rescuerelay-qa.org'),
      ('d0000000-0000-4000-a000-000000000002'::uuid, 'recipient@rescuerelay-qa.org'),
      ('d0000000-0000-4000-a000-000000000003'::uuid, 'driver@rescuerelay-qa.org'),
      ('d0000000-0000-4000-a000-000000000004'::uuid, 'coordinator@rescuerelay-qa.org')
    ) AS t(id, email)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = demo.email) THEN
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', demo.id, 'authenticated', 'authenticated',
        demo.email, crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('email', demo.email, 'email_verified', true),
        now(), now(), '', '', '', ''
      );

      INSERT INTO auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), demo.id, demo.id::text,
        jsonb_build_object('sub', demo.id::text, 'email', demo.email, 'email_verified', true),
        'email', now(), now(), now()
      );
    END IF;
  END LOOP;
END $$;

-- Resolve the four accounts by email, so hand-created users work too.
CREATE TEMP TABLE demo_users ON COMMIT DROP AS
SELECT
  (SELECT id FROM auth.users WHERE email = 'donor@rescuerelay-qa.org')       AS donor_id,
  (SELECT id FROM auth.users WHERE email = 'recipient@rescuerelay-qa.org')   AS recipient_id,
  (SELECT id FROM auth.users WHERE email = 'driver@rescuerelay-qa.org')      AS driver_id,
  (SELECT id FROM auth.users WHERE email = 'coordinator@rescuerelay-qa.org') AS coordinator_id;

DO $$
BEGIN
  IF (SELECT donor_id FROM demo_users) IS NULL
     OR (SELECT recipient_id FROM demo_users) IS NULL
     OR (SELECT driver_id FROM demo_users) IS NULL
     OR (SELECT coordinator_id FROM demo_users) IS NULL THEN
    RAISE EXCEPTION 'Demo accounts were not created. Add them under Authentication -> Users with Auto Confirm ticked, then re-run.';
  END IF;
END $$;

-- ===========================================================================
-- 2. Clear anything this script previously created
-- ===========================================================================
-- Donations cascade to matches, deliveries and rescue events.
DELETE FROM public.donations     WHERE id   >= 'd1000000-0000-4000-a000-000000000000'::uuid
                                   AND id   <= 'd1ffffff-ffff-4fff-afff-ffffffffffff'::uuid;
DELETE FROM public.user_roles    WHERE user_id IN (SELECT unnest(ARRAY[donor_id, recipient_id, driver_id, coordinator_id]) FROM demo_users);
DELETE FROM public.profiles      WHERE id      IN (SELECT unnest(ARRAY[donor_id, recipient_id, driver_id, coordinator_id]) FROM demo_users);
DELETE FROM public.organizations WHERE id   >= 'd2000000-0000-4000-a000-000000000000'::uuid
                                   AND id   <= 'd2ffffff-ffff-4fff-afff-ffffffffffff'::uuid;

-- ===========================================================================
-- 3. Organizations
-- ===========================================================================
-- Recipients are the food banks shown in Partners and named on each Opportunity.
-- Contact columns come from migration 0011; apply it before running this, or drop the
-- last four values from each row.
INSERT INTO public.organizations
  (id, name, type, verification_status, address, latitude, longitude, cold_storage, capacity_lbs, accepted_categories, households_served, phone, contact_email, hours_note, website)
VALUES
  ('d2000000-0000-4000-a000-000000000001', 'Riverbend Food Pantry',          'recipient', 'verified',  '2220 E 17th St, Des Moines, IA 50316',   41.614357, -93.591134, true,  420, ARRAY['prepared meals','produce','dairy'],          310, '515-555-0141', 'intake@riverbendpantry-qa.org', 'Mon-Sat 8am-5pm', 'https://riverbendpantry-qa.org'),
  ('d2000000-0000-4000-a000-000000000002', 'Southside Community Table',      'recipient', 'verified',  '100 Army Post Rd, Des Moines, IA 50315',  41.526379, -93.617538, true,  600, ARRAY['produce','bakery','dairy','prepared meals'], 540, '515-555-0162', 'receiving@southsidetable-qa.org', 'Daily 7am-7pm', 'https://southsidetable-qa.org'),
  ('d2000000-0000-4000-a000-000000000003', 'Mulberry Street Shelter Kitchen','recipient', 'verified',  '1420 Mulberry St, Des Moines, IA 50314',  41.582870, -93.633848, true,  250, ARRAY['prepared meals','bakery'],                   180, '515-555-0178', 'kitchen@mulberryshelter-qa.org', 'Mon-Fri 6am-8pm', 'https://mulberryshelter-qa.org'),
  ('d2000000-0000-4000-a000-000000000004', 'Hartford Avenue Neighbors',      'recipient', 'verified',  '1203 Hartford Ave, Des Moines, IA 50315', 41.569679, -93.598394, false, 150, ARRAY['produce','bakery'],                           95, '515-555-0109', 'hello@hartfordneighbors-qa.org', 'Tue, Thu 9am-2pm', 'https://hartfordneighbors-qa.org'),
  ('d2000000-0000-4000-a000-000000000005', 'Hickman Road Pantry',            'recipient', 'verified',  '1815 Hickman Rd, Des Moines, IA 50314',   41.615109, -93.641508, true,  380, ARRAY['produce','dairy','prepared meals'],          265, '515-555-0133', 'dock@hickmanroadpantry-qa.org', 'Mon-Fri 8am-4pm', 'https://hickmanroadpantry-qa.org'),
  -- Not verified: proves the directory hides unverified partners from volunteers
  -- while coordinators still see them and can act.
  ('d2000000-0000-4000-a000-000000000006', 'Capitol East Community Fridge',  'recipient', 'pending',   '3000 E University Ave, Des Moines, IA 50317', 41.600633, -93.558327, true, 120, ARRAY['produce','dairy'],                        70, '515-555-0190', 'team@capitoleastfridge-qa.org', 'Open 24/7 (unstaffed)', ''),
  ('d2000000-0000-4000-a000-000000000007', 'Aurora Avenue Relief Center',    'recipient', 'suspended', '6200 Aurora Ave, Urbandale, IA 50322',    41.636603, -93.703255, true,  300, ARRAY['produce','bakery'],                          210, '515-555-0155', 'office@auroraavenue-qa.org', 'Suspended pending review', ''),
  -- Donor-side organizations.
  ('d2000000-0000-4000-a000-000000000008', 'Court Avenue Kitchen Co.',       'donor',     'verified',  '420 Court Ave, Des Moines, IA 50309',     41.584932, -93.621926, true,  0,   ARRAY[]::text[],                                      0, '515-555-0117', 'surplus@courtavekitchen-qa.org', 'Pickups after 2pm daily', 'https://courtavekitchen-qa.org'),
  ('d2000000-0000-4000-a000-000000000009', 'Grand Avenue Hotel Kitchen',     'donor',     'verified',  '700 Grand Ave, Des Moines, IA 50309',     41.587423, -93.626576, true,  0,   ARRAY[]::text[],                                      0, '515-555-0124', 'banquets@grandavehotel-qa.org', 'Pickups 9pm-11pm', 'https://grandavehotel-qa.org');

-- ===========================================================================
-- 4. Profiles and roles
-- ===========================================================================
INSERT INTO public.profiles (id, full_name, phone, organization_id, onboarding_complete, availability, vehicle_capacity_lbs, food_safety_training)
SELECT donor_id,       'Dana Okafor',   '515-555-0101', 'd2000000-0000-4000-a000-000000000008', true, true, 0,   false FROM demo_users
UNION ALL
SELECT recipient_id,   'Rosa Lindqvist','515-555-0102', 'd2000000-0000-4000-a000-000000000001', true, true, 0,   false FROM demo_users
UNION ALL
SELECT driver_id,      'Devon Marsh',   '515-555-0103', NULL,                                   true, true, 250, true  FROM demo_users
UNION ALL
SELECT coordinator_id, 'Casey Ahmed',   '515-555-0104', NULL,                                   true, true, 0,   true  FROM demo_users;

INSERT INTO public.user_roles (user_id, role)
SELECT donor_id, 'donor'::public.app_role FROM demo_users
UNION ALL SELECT recipient_id,   'recipient'::public.app_role   FROM demo_users
UNION ALL SELECT driver_id,      'driver'::public.app_role      FROM demo_users
UNION ALL SELECT coordinator_id, 'coordinator'::public.app_role FROM demo_users;

-- ===========================================================================
-- 5. Rescues, one per lifecycle stage
-- ===========================================================================
INSERT INTO public.donations
  (id, donor_user_id, donor_org_id, title, category, pounds, servings, pickup_address, pickup_deadline, storage_required, allergens, notes, latitude, longitude, status, created_at)
SELECT * FROM (
  SELECT
    'd1000000-0000-4000-a000-000000000001'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000008'::uuid,
    'Hot line prepared meals', 'prepared meals', 180.00, 150, '420 Court Ave, Des Moines, IA 50309',
    now() + interval '6 hours', 'refrigerated', 'Contains dairy; some trays contain wheat',
    'Sealed at 2pm service. Hold at or below 41F.', 41.584932, -93.621926, 'open'::public.donation_status, now() - interval '25 minutes'
  FROM demo_users
  UNION ALL SELECT
    'd1000000-0000-4000-a000-000000000002'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000009'::uuid,
    'Bakery surplus trays', 'bakery', 90.00, 75, '730 3rd St, Des Moines, IA 50309',
    now() + interval '3 hours', 'ambient', 'Contains wheat, eggs',
    'Baked this morning. Boxed and ready at the loading dock.', 41.591857, -93.621694, 'matched'::public.donation_status, now() - interval '50 minutes'
  FROM demo_users
  UNION ALL SELECT
    'd1000000-0000-4000-a000-000000000003'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000008'::uuid,
    'Chilled produce flats', 'produce', 240.00, 200, '1101 Walnut St, Des Moines, IA 50309',
    now() + interval '5 hours', 'refrigerated', 'None',
    'Twelve flats, mixed greens and peppers. Needs a cooler or insulated bins.', 41.584659, -93.630789, 'accepted'::public.donation_status, now() - interval '70 minutes'
  FROM demo_users
  UNION ALL SELECT
    'd1000000-0000-4000-a000-000000000004'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000009'::uuid,
    'Dairy case pull', 'dairy', 120.00, 100, '2507 University Ave, Des Moines, IA 50311',
    now() + interval '4 hours', 'refrigerated', 'Contains milk',
    'Short-dated yogurt and milk. Cold chain required end to end.', 41.600446, -93.652109, 'driver_assigned'::public.donation_status, now() - interval '2 hours'
  FROM demo_users
  UNION ALL SELECT
    'd1000000-0000-4000-a000-000000000005'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000009'::uuid,
    'Catering overage', 'prepared meals', 150.00, 125, '700 Grand Ave, Des Moines, IA 50309',
    now() + interval '2 hours', 'refrigerated', 'Contains dairy, wheat, soy',
    'Banquet overage, portioned into hotel pans.', 41.587423, -93.626576, 'picked_up'::public.donation_status, now() - interval '3 hours'
  FROM demo_users
  UNION ALL SELECT
    'd1000000-0000-4000-a000-000000000006'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000008'::uuid,
    'Weekend produce rescue', 'produce', 310.00, 258, '420 Court Ave, Des Moines, IA 50309',
    now() - interval '20 hours', 'refrigerated', 'None',
    'Saturday market surplus.', 41.584932, -93.621926, 'delivered'::public.donation_status, now() - interval '26 hours'
  FROM demo_users
  UNION ALL SELECT
    'd1000000-0000-4000-a000-000000000007'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000009'::uuid,
    'Frozen entree surplus', 'prepared meals', 260.00, 216, '700 Grand Ave, Des Moines, IA 50309',
    now() - interval '2 days', 'frozen', 'Contains wheat, soy',
    'Over-ordered banquet entrees, kept frozen.', 41.587423, -93.626576, 'delivered'::public.donation_status, now() - interval '2 days 4 hours'
  FROM demo_users
  UNION ALL SELECT
    'd1000000-0000-4000-a000-000000000008'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000008'::uuid,
    'Late night sandwich trays', 'prepared meals', 70.00, 58, '420 Court Ave, Des Moines, IA 50309',
    now() - interval '8 hours', 'refrigerated', 'Contains wheat, dairy',
    'Posted too close to closing; nobody could collect in time.', 41.584932, -93.621926, 'expired'::public.donation_status, now() - interval '14 hours'
  FROM demo_users
  UNION ALL SELECT
    'd1000000-0000-4000-a000-000000000009'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000009'::uuid,
    'Soup batch, held hot', 'prepared meals', 95.00, 79, '730 3rd St, Des Moines, IA 50309',
    now() - interval '2 hours', 'refrigerated', 'Contains celery, dairy',
    'Offered but never answered. Needs a coordinator to close it out.', 41.591857, -93.621694, 'matched'::public.donation_status, now() - interval '7 hours'
  FROM demo_users
  UNION ALL SELECT
    'd1000000-0000-4000-a000-00000000000a'::uuid, donor_id, 'd2000000-0000-4000-a000-000000000008'::uuid,
    'Deli case overstock', 'prepared meals', 110.00, 92, '420 Court Ave, Des Moines, IA 50309',
    now() + interval '9 hours', 'refrigerated', 'Contains dairy, wheat, mustard',
    'Declined by the nearest pantry; still open to others.', 41.584932, -93.621926, 'open'::public.donation_status, now() - interval '95 minutes'
  FROM demo_users
) AS seeded;

-- ===========================================================================
-- 6. Matches
-- ===========================================================================
INSERT INTO public.matches (id, donation_id, recipient_org_id, score, explanation, status, responded_by, responded_at, created_at)
SELECT * FROM (
  -- D1 open: three live offers, nobody has answered yet.
  SELECT 'd3000000-0000-4000-a000-000000000001'::uuid, 'd1000000-0000-4000-a000-000000000001'::uuid, 'd2000000-0000-4000-a000-000000000003'::uuid, 88,
         '1.0 miles away - storage ready - serves 180 households - accepts this food', 'proposed'::public.match_status, NULL::uuid, NULL::timestamptz, now() - interval '24 minutes' FROM demo_users
  UNION ALL SELECT 'd3000000-0000-4000-a000-000000000002'::uuid, 'd1000000-0000-4000-a000-000000000001'::uuid, 'd2000000-0000-4000-a000-000000000001'::uuid, 81,
         '2.4 miles away - storage ready - serves 310 households - accepts this food', 'proposed'::public.match_status, NULL, NULL, now() - interval '24 minutes' FROM demo_users
  UNION ALL SELECT 'd3000000-0000-4000-a000-000000000003'::uuid, 'd1000000-0000-4000-a000-000000000001'::uuid, 'd2000000-0000-4000-a000-000000000005'::uuid, 74,
         '2.5 miles away - storage ready - serves 265 households - accepts this food', 'proposed'::public.match_status, NULL, NULL, now() - interval '24 minutes' FROM demo_users

  -- D2 matched: offered to the demo recipient's own pantry and still unanswered.
  UNION ALL SELECT 'd3000000-0000-4000-a000-000000000004'::uuid, 'd1000000-0000-4000-a000-000000000002'::uuid, 'd2000000-0000-4000-a000-000000000001'::uuid, 86,
         '2.0 miles away - storage ready - serves 310 households - accepts this food', 'proposed'::public.match_status, NULL, NULL, now() - interval '48 minutes' FROM demo_users
  UNION ALL SELECT 'd3000000-0000-4000-a000-000000000005'::uuid, 'd1000000-0000-4000-a000-000000000002'::uuid, 'd2000000-0000-4000-a000-000000000004'::uuid, 69,
         '2.1 miles away - storage ready - serves 95 households - accepts this food', 'proposed'::public.match_status, NULL, NULL, now() - interval '48 minutes' FROM demo_users

  -- D3 accepted, nobody driving yet: this is the claimable run.
  UNION ALL SELECT 'd3000000-0000-4000-a000-000000000006'::uuid, 'd1000000-0000-4000-a000-000000000003'::uuid, 'd2000000-0000-4000-a000-000000000002'::uuid, 91,
         '4.1 miles away - storage ready - serves 540 households - accepts this food', 'accepted'::public.match_status, NULL, now() - interval '55 minutes', now() - interval '68 minutes' FROM demo_users

  -- D4 claimed by the demo driver, not yet collected.
  UNION ALL SELECT 'd3000000-0000-4000-a000-000000000007'::uuid, 'd1000000-0000-4000-a000-000000000004'::uuid, 'd2000000-0000-4000-a000-000000000005'::uuid, 84,
         '1.5 miles away - storage ready - serves 265 households - accepts this food', 'accepted'::public.match_status, recipient_id, now() - interval '110 minutes', now() - interval '2 hours' FROM demo_users

  -- D5 in transit.
  UNION ALL SELECT 'd3000000-0000-4000-a000-000000000008'::uuid, 'd1000000-0000-4000-a000-000000000005'::uuid, 'd2000000-0000-4000-a000-000000000003'::uuid, 89,
         '0.6 miles away - storage ready - serves 180 households - accepts this food', 'accepted'::public.match_status, recipient_id, now() - interval '2 hours 40 minutes', now() - interval '3 hours' FROM demo_users

  -- D6 delivered to the demo recipient's pantry.
  UNION ALL SELECT 'd3000000-0000-4000-a000-000000000009'::uuid, 'd1000000-0000-4000-a000-000000000006'::uuid, 'd2000000-0000-4000-a000-000000000001'::uuid, 93,
         '2.4 miles away - storage ready - serves 310 households - accepts this food', 'accepted'::public.match_status, recipient_id, now() - interval '25 hours', now() - interval '25 hours 30 minutes' FROM demo_users

  -- D7 delivered elsewhere.
  UNION ALL SELECT 'd3000000-0000-4000-a000-00000000000a'::uuid, 'd1000000-0000-4000-a000-000000000007'::uuid, 'd2000000-0000-4000-a000-000000000002'::uuid, 87,
         '4.3 miles away - storage ready - serves 540 households - accepts this food', 'accepted'::public.match_status, NULL, now() - interval '2 days 3 hours', now() - interval '2 days 3 hours 30 minutes' FROM demo_users

  -- D9 offered to the demo recipient but never answered before the window closed.
  UNION ALL SELECT 'd3000000-0000-4000-a000-00000000000b'::uuid, 'd1000000-0000-4000-a000-000000000009'::uuid, 'd2000000-0000-4000-a000-000000000001'::uuid, 72,
         '2.0 miles away - storage ready - serves 310 households - accepts this food', 'proposed'::public.match_status, NULL, NULL, now() - interval '6 hours 50 minutes' FROM demo_users

  -- D10 turned down by the demo recipient.
  UNION ALL SELECT 'd3000000-0000-4000-a000-00000000000c'::uuid, 'd1000000-0000-4000-a000-00000000000a'::uuid, 'd2000000-0000-4000-a000-000000000001'::uuid, 78,
         '2.4 miles away - storage ready - serves 310 households - accepts this food', 'declined'::public.match_status, recipient_id, now() - interval '80 minutes', now() - interval '94 minutes' FROM demo_users
) AS seeded;

-- ===========================================================================
-- 7. Deliveries
-- ===========================================================================
-- D3 deliberately has no delivery row, which is what leaves it claimable.
INSERT INTO public.deliveries (id, match_id, driver_user_id, driver_name, picked_up_at, delivered_at, recipient_confirmation, safety_acknowledged, created_at)
SELECT * FROM (
  SELECT 'd4000000-0000-4000-a000-000000000001'::uuid, 'd3000000-0000-4000-a000-000000000007'::uuid, driver_id, 'Devon Marsh',
         NULL::timestamptz, NULL::timestamptz, NULL::text, false, now() - interval '100 minutes' FROM demo_users
  UNION ALL SELECT 'd4000000-0000-4000-a000-000000000002'::uuid, 'd3000000-0000-4000-a000-000000000008'::uuid, driver_id, 'Devon Marsh',
         now() - interval '35 minutes', NULL, NULL, true, now() - interval '2 hours 30 minutes' FROM demo_users
  UNION ALL SELECT 'd4000000-0000-4000-a000-000000000003'::uuid, 'd3000000-0000-4000-a000-000000000009'::uuid, driver_id, 'Devon Marsh',
         now() - interval '24 hours 20 minutes', now() - interval '23 hours 48 minutes', 'Received in safe condition', true, now() - interval '24 hours 50 minutes' FROM demo_users
  UNION ALL SELECT 'd4000000-0000-4000-a000-000000000004'::uuid, 'd3000000-0000-4000-a000-00000000000a'::uuid, driver_id, 'Devon Marsh',
         now() - interval '2 days 2 hours 30 minutes', now() - interval '2 days 1 hour 45 minutes', 'Received in safe condition', true, now() - interval '2 days 2 hours 50 minutes' FROM demo_users
) AS seeded;

-- ===========================================================================
-- 8. Rescue events, for the network log
-- ===========================================================================
INSERT INTO public.rescue_events (donation_id, actor_user_id, event_type, detail, created_at)
SELECT * FROM (
  SELECT 'd1000000-0000-4000-a000-000000000001'::uuid, donor_id,     'donation_posted',    '180 lb prepared meals posted - pickup located via us_census', now() - interval '25 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000002'::uuid, donor_id,     'donation_posted',    '90 lb bakery posted - pickup located via us_census',         now() - interval '50 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000003'::uuid, donor_id,     'donation_posted',    '240 lb produce posted - pickup located via us_census',       now() - interval '70 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000003'::uuid, recipient_id, 'recipient_accepted', 'Recipient marked match accepted',                            now() - interval '55 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000004'::uuid, donor_id,     'donation_posted',    '120 lb dairy posted - pickup located via us_census',         now() - interval '2 hours'    FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000004'::uuid, recipient_id, 'recipient_accepted', 'Recipient marked match accepted',                            now() - interval '110 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000004'::uuid, driver_id,    'driver_assigned',    'Volunteer driver accepted the route',                        now() - interval '100 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000005'::uuid, driver_id,    'driver_assigned',    'Volunteer driver accepted the route',                        now() - interval '2 hours 30 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000005'::uuid, driver_id,    'picked_up',          'Pickup confirmed with safety acknowledgement',               now() - interval '35 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000006'::uuid, driver_id,    'picked_up',          'Pickup confirmed with safety acknowledgement',               now() - interval '24 hours 20 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000006'::uuid, driver_id,    'delivered',          'Delivery confirmed by recipient',                            now() - interval '23 hours 48 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-000000000007'::uuid, driver_id,    'delivered',          'Delivery confirmed by recipient',                            now() - interval '2 days 1 hour 45 minutes' FROM demo_users
  UNION ALL SELECT 'd1000000-0000-4000-a000-00000000000a'::uuid, recipient_id, 'recipient_declined', 'Recipient marked match declined',                            now() - interval '80 minutes' FROM demo_users
) AS seeded;

COMMIT;

-- ===========================================================================
-- What you should see
-- ===========================================================================
SELECT 'accounts'      AS seeded, count(*) FROM auth.users WHERE email LIKE '%@rescuerelay-qa.org'
UNION ALL SELECT 'food banks (verified)', count(*) FROM public.organizations WHERE type = 'recipient' AND verification_status = 'verified'
UNION ALL SELECT 'food banks (other)',    count(*) FROM public.organizations WHERE type = 'recipient' AND verification_status <> 'verified'
UNION ALL SELECT 'rescues',               count(*) FROM public.donations     WHERE id >= 'd1000000-0000-4000-a000-000000000000'::uuid
UNION ALL SELECT 'matches',               count(*) FROM public.matches       WHERE id >= 'd3000000-0000-4000-a000-000000000000'::uuid
UNION ALL SELECT 'deliveries',            count(*) FROM public.deliveries    WHERE id >= 'd4000000-0000-4000-a000-000000000000'::uuid;
