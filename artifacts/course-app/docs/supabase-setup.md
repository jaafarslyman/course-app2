# Supabase setup

## Environment variables

Add these exact names to the Replit environment:

- `VITE_SUPABASE_URL` — the Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` — the Supabase anon/publishable key used by the browser.
- `SUPABASE_SERVICE_ROLE_KEY` — the private service-role key used only by the API server to create short-lived media links.

The two `VITE_` values are included in the browser bundle and must not contain secrets. Keep the service-role key private: do not rename it with a `VITE_` prefix, add it to source control, or expose it to the browser.

## Database setup

1. Create the administrator account in Supabase Authentication using the email and password you want to use.
2. In `supabase/schema.sql`, replace `YOUR_ADMIN_EMAIL_HERE` with that exact email address. Run the entire file in the Supabase SQL Editor. The final block registers the existing Auth account as a course administrator.
3. Run the entire `supabase/courses.sql` file in the SQL Editor. It creates the course tables, RPCs, private `course-media` bucket, and storage policies.
4. Restart the app and API server after adding the environment variables. Sign in at `/admin/sign-in`; learners start at `/`.

There is no sample course content. Create and publish a course from the admin area after setup.

## Media-protection limits

Course media is stored privately and delivered through signed links after the app checks access. The player hides download and remote-playback controls, blocks the context menu and common copy/save/print shortcuts, and pauses media when the page is hidden. These are deterrents only: a regular web browser cannot prevent operating-system screenshots or screen recordings, and signed links can still be captured while valid. Do not treat the web version as DRM or perfect anti-copy protection.
