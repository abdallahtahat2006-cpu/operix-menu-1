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
    url: '',
    anonKey: ''
};
