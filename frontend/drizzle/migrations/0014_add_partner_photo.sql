-- The partner directory identifies an organization by name and street address alone,
-- which is slow to scan and gives a driver nothing to recognise on arrival. A photo
-- is directory information for an already-verified partner, so it is readable under
-- the same policy as the rest of the row, exactly as the contact columns in 0011 are.
--
-- Nullable rather than defaulted: a partner without a photo is a real state the card
-- renders a fallback for, not an empty string to be distinguished from one.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS photo_url text CHECK (photo_url IS NULL OR char_length(photo_url) <= 500);

COMMENT ON COLUMN public.organizations.photo_url IS 'Directory photo of the partner site, shown on the partner card. Null when none has been supplied.';
