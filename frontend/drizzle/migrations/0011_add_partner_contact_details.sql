-- The partner directory is where a donor decides who to call and a driver works out
-- where they are going, but organizations carried no contact details at all — only a
-- street address. These columns are directory information for an already-verified
-- partner, so they are readable under the same policy as the rest of the row.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS phone         text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 30),
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '' CHECK (char_length(contact_email) <= 160),
  ADD COLUMN IF NOT EXISTS website       text NOT NULL DEFAULT '' CHECK (char_length(website) <= 240),
  ADD COLUMN IF NOT EXISTS hours_note    text NOT NULL DEFAULT '' CHECK (char_length(hours_note) <= 240);

COMMENT ON COLUMN public.organizations.phone IS 'Dispatch contact number shown in the partner directory.';
COMMENT ON COLUMN public.organizations.hours_note IS 'Free-text receiving hours, e.g. "Mon-Fri 8am-4pm".';
