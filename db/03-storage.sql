-- =========================================================================
-- Operix Restaurant System — image storage
-- Run after 01-schema.sql. One public bucket for dish photos and the venue
-- shot: anyone may look at them (they are printed on the menu), only staff
-- may put them there.
--
-- If the SQL editor refuses the storage.objects policies (older projects),
-- create the same four rules from Storage → Policies in the dashboard.
-- =========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu', 'menu', true, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/avif'])
on conflict (id) do update
    set public = true,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "menu images are readable"  on storage.objects;
drop policy if exists "staff upload menu images"  on storage.objects;
drop policy if exists "staff replace menu images" on storage.objects;
drop policy if exists "staff delete menu images"  on storage.objects;

create policy "menu images are readable" on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'menu');

create policy "staff upload menu images" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'menu' and public.is_staff());

create policy "staff replace menu images" on storage.objects
    for update to authenticated
    using (bucket_id = 'menu' and public.is_staff())
    with check (bucket_id = 'menu' and public.is_staff());

create policy "staff delete menu images" on storage.objects
    for delete to authenticated
    using (bucket_id = 'menu' and public.is_staff());
