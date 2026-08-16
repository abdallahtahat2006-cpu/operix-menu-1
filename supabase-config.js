/* =========================================================================
   Operix Restaurant System — Supabase connection
   -------------------------------------------------------------------------
   The only file you edit after creating the project. Both values below are
   public by design: the anon key is meant to ship in the browser, and every
   table is protected by row level security, not by hiding this key.

   NEVER put the service_role key here. It bypasses RLS.

   Find them in the Supabase dashboard → Project Settings → API:
       Project URL         → url
       Project API keys → anon public → anonKey

   Leaving them empty is fine while developing: the system falls back to the
   local (localStorage) engine and keeps working on one device.
   ========================================================================= */
window.SUPABASE_CONFIG = {
    url: 'https://rbcbcnyokkrryamuvuee.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJiY2Jjbnlva2tycnlhbXV2dWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzQ5OTcsImV4cCI6MjEwMjQ1MDk5N30.zyXcHDGfW5SyXmSqQl5DK77jXylrBeeZcxj3Z2CgjZw'
};
