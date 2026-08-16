-- =========================================================================
-- Operix Restaurant System — Supabase schema (single restaurant)
--
-- Run this first, in the Supabase SQL editor, on a fresh project.
-- It is idempotent enough to re-run after a `drop schema public cascade`,
-- but not a migration tool: for changes, add a new numbered file.
--
-- Roles this schema knows about
--   anon           — nobody signed in yet (reads the public menu only)
--   authenticated  — either a guest device (anonymous sign-in) or a staff
--                    member. Staff is whoever has a row in public.staff.
--
-- The guest is a real Supabase user created by signInAnonymously(), so RLS
-- can tie every order to the device that placed it: one table cannot read
-- another table's tickets, while staff read the whole floor.
-- =========================================================================

-- --- helpers -------------------------------------------------------------

-- gen_random_uuid() is in core PostgreSQL since 13, so no extension is needed.

-- NOTE: is_staff() and is_manager() live further down, right after the staff
-- table. A `language sql` body is parsed when the function is created, so it
-- cannot mention a table that does not exist yet.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- Ticket codes the kitchen can shout across a room: B33, C07, …
create sequence if not exists public.order_code_seq;

-- One nextval per code: two calls in the same expression would burn two
-- numbers and pair a letter with the wrong digits.
create or replace function public.gen_order_code()
returns text
language sql
volatile
as $$
    with n as (select nextval('public.order_code_seq')::int as v)
    select chr(65 + ((v / 100) % 26)) || lpad((v % 100)::text, 2, '0') from n;
$$;

-- =========================================================================
-- 1. Staff
-- =========================================================================
create table if not exists public.staff (
    id          uuid primary key references auth.users (id) on delete cascade,
    full_name   text not null default '',
    role        text not null default 'waiter'
                check (role in ('waiter', 'cashier', 'manager')),
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);

comment on table public.staff is
    'Whoever may open the floor console and the dashboard. One row per auth user.';

-- Every policy below asks these two questions. `security definer` keeps a
-- policy on `staff` from recursing into itself.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.staff s
        where s.id = auth.uid() and s.active
    );
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.staff s
        where s.id = auth.uid() and s.active and s.role = 'manager'
    );
$$;

-- =========================================================================
-- 2. Restaurant settings — exactly one row
-- =========================================================================
create table if not exists public.settings (
    id            smallint primary key default 1 check (id = 1),

    name          text not null default 'Restaurant',
    tagline_ar    text not null default '',
    tagline_en    text not null default '',
    address_ar    text not null default '',
    address_en    text not null default '',
    phone         text not null default '',
    wifi          text not null default '',
    currency      text not null default '$',
    hero_url      text,

    open_hour     smallint not null default 8  check (open_hour  between 0 and 23),
    close_hour    smallint not null default 23 check (close_hour between 0 and 23),
    service_pct   numeric(4,3) not null default 0.100 check (service_pct >= 0 and service_pct <= 1),

    tables_count  smallint not null default 24 check (tables_count between 1 and 200),

    -- 'approval' = the ticket waits for the cashier, 'direct' = straight to the kitchen
    flow          text not null default 'approval' check (flow in ('approval', 'direct')),

    -- which built-in table services the guest is offered: {"water": true, …}
    services      jsonb not null default '{"question":true,"water":true,"cutlery":true,"bill":true}'::jsonb,
    -- extra services the owner invented: [{"id","icon","ar","en"}]
    extra_services jsonb not null default '[]'::jsonb,
    payments      jsonb not null default '{"cash":true,"card":true,"split":true}'::jsonb,

    base_url      text not null default '',   -- what the table QR codes point at

    -- Turn on once the tokened QR codes are printed: a guest can then no
    -- longer open a session by typing ?table=12 from home.
    qr_required   boolean not null default false,

    updated_at    timestamptz not null default now()
);

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
    for each row execute function public.touch_updated_at();

-- =========================================================================
-- 3. Menu
-- =========================================================================
create table if not exists public.categories (
    id          text primary key,            -- slug: 'breakfast', 'grill-43'
    name_ar     text not null,
    name_en     text not null,
    note_ar     text not null default '',
    note_en     text not null default '',
    img_url     text,
    sort        integer not null default 0,
    hidden      boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.items (
    id           text primary key,           -- slug: 'avocado-toast'
    category_id  text not null references public.categories (id) on update cascade on delete restrict,

    name_ar      text not null,
    name_en      text not null,
    desc_ar      text not null default '',
    desc_en      text not null default '',

    price        numeric(10,2) not null default 0 check (price >= 0),
    img_url      text,

    tags         text[] not null default '{}',        -- 'veg', 'spicy', 'chef' …
    kcal         integer not null default 0,
    prep_min     integer not null default 0,
    serves       integer not null default 1,
    rating       numeric(2,1) not null default 5.0 check (rating >= 0 and rating <= 5),

    -- shapes the guest app already speaks; kept as jsonb so the dashboard can
    -- edit them freely without a migration per option group
    options      jsonb not null default '[]'::jsonb,  -- [{id,name:{ar,en},required,multi,choices:[…]}]
    ingredients  jsonb not null default '[]'::jsonb,  -- [{ar,en,allergen:{ar,en}}]
    pairings     text[] not null default '{}',        -- item ids

    available    boolean not null default true,       -- out of stock, still listed
    hidden       boolean not null default false,      -- off the menu entirely
    sort         integer not null default 0,

    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists items_category_idx on public.items (category_id, sort);
create index if not exists items_visible_idx  on public.items (hidden, available);

drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories
    for each row execute function public.touch_updated_at();

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
    for each row execute function public.touch_updated_at();

-- =========================================================================
-- 4. Tables and their QR codes
-- =========================================================================
create table if not exists public.tables (
    id          smallint primary key,        -- the number printed on the card
    label_ar    text,
    label_en    text,
    seats       smallint not null default 4,
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);

-- The QR secret lives in its own table because RLS cannot hide one column:
-- every guest may read `tables`, but only staff may read the tokens.
create table if not exists public.table_secrets (
    table_id  smallint primary key references public.tables (id) on delete cascade,
    qr_token  uuid not null default gen_random_uuid()
);

create or replace function public.ensure_table_secret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.table_secrets (table_id) values (new.id)
    on conflict (table_id) do nothing;
    return null;
end;
$$;

drop trigger if exists tables_secret on public.tables;
create trigger tables_secret after insert on public.tables
    for each row execute function public.ensure_table_secret();

-- =========================================================================
-- 5. Sessions — one per seating, the spine of a table's life
-- =========================================================================
create table if not exists public.sessions (
    id          uuid primary key default gen_random_uuid(),
    table_id    smallint not null references public.tables (id) on delete cascade,
    guests      smallint not null default 2 check (guests between 1 and 40),
    status      text not null default 'open' check (status in ('open', 'closed')),
    opened_by   text not null default 'guest' check (opened_by in ('guest', 'staff')),
    created_by  uuid references auth.users (id) on delete set null,
    opened_at   timestamptz not null default now(),
    closed_at   timestamptz
);

-- Deliberately NOT unique per table: two friends on two phones at table 12
-- each get their own session, and the table's bill is the sum of them. A
-- guest cannot read another guest's session, so sharing one row is impossible
-- without leaking the whole table.
create index if not exists sessions_open_idx  on public.sessions (status, opened_at desc);
create index if not exists sessions_table_idx on public.sessions (table_id, status);

-- =========================================================================
-- 6. Orders
-- =========================================================================
create table if not exists public.orders (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references public.sessions (id) on delete cascade,
    table_id     smallint not null references public.tables (id) on delete cascade,

    code         text not null default public.gen_order_code(),

    -- 'pending' means: nobody on the floor has touched it yet. In 'approval'
    -- mode it is waiting for the cashier; in 'direct' mode the kitchen
    -- already has it and the console only advances it.
    status       text not null default 'pending'
                 check (status in ('pending', 'confirmed', 'preparing', 'ready', 'served', 'rejected')),

    source       text not null default 'guest' check (source in ('guest', 'staff')),
    note         text not null default '',
    edited       boolean not null default false,
    rejected_reason text,

    total        numeric(10,2) not null default 0,   -- kept by trigger from order_items

    created_by   uuid references auth.users (id) on delete set null,
    handled_by   uuid references public.staff (id) on delete set null,

    placed_at    timestamptz not null default now(),
    status_at    timestamptz not null default now()
);

create index if not exists orders_live_idx    on public.orders (status, placed_at desc);
create index if not exists orders_session_idx on public.orders (session_id);
create index if not exists orders_table_idx   on public.orders (table_id, placed_at desc);

-- Every line is a snapshot: the menu may change tonight, the ticket must not.
create table if not exists public.order_items (
    id           uuid primary key default gen_random_uuid(),
    order_id     uuid not null references public.orders (id) on delete cascade,
    item_id      text references public.items (id) on update cascade on delete set null,

    name_ar      text not null,
    name_en      text not null,
    img_url      text,
    unit_price   numeric(10,2) not null check (unit_price >= 0),
    qty          smallint not null check (qty > 0),
    options_text text not null default '',
    note         text not null default ''
);

create index if not exists order_items_order_idx on public.order_items (order_id);

create or replace function public.refresh_order_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    target uuid := coalesce(new.order_id, old.order_id);
begin
    update public.orders o
       set total = coalesce((
               select sum(oi.unit_price * oi.qty)
                 from public.order_items oi
                where oi.order_id = target
           ), 0)
     where o.id = target;
    return null;
end;
$$;

drop trigger if exists order_items_total on public.order_items;
create trigger order_items_total
    after insert or update or delete on public.order_items
    for each row execute function public.refresh_order_total();

create or replace function public.stamp_order_status()
returns trigger
language plpgsql
as $$
begin
    if new.status is distinct from old.status then
        new.status_at = now();
    end if;
    return new;
end;
$$;

drop trigger if exists orders_stamp on public.orders;
create trigger orders_stamp before update on public.orders
    for each row execute function public.stamp_order_status();

-- =========================================================================
-- 7. Service calls
-- =========================================================================
create table if not exists public.service_calls (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references public.sessions (id) on delete cascade,
    table_id    smallint not null references public.tables (id) on delete cascade,

    reason      text not null,               -- service id: 'water', 'bill', 'x-ab12'
    status      text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),

    created_by  uuid references auth.users (id) on delete set null,
    resolved_by uuid references public.staff (id) on delete set null,
    created_at  timestamptz not null default now(),
    resolved_at timestamptz
);

create index if not exists calls_open_idx on public.service_calls (status, created_at desc);

-- =========================================================================
-- 8. Bills
-- =========================================================================
create table if not exists public.bills (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references public.sessions (id) on delete cascade,
    table_id    smallint not null references public.tables (id) on delete cascade,

    method      text not null check (method in ('cash', 'card', 'split')),
    tip_pct     smallint not null default 0 check (tip_pct between 0 and 100),
    amount      numeric(10,2) not null default 0,
    status      text not null default 'requested'
                check (status in ('requested', 'settled', 'cancelled')),

    created_by  uuid references auth.users (id) on delete set null,
    settled_by  uuid references public.staff (id) on delete set null,
    created_at  timestamptz not null default now(),
    settled_at  timestamptz
);

create index if not exists bills_open_idx on public.bills (status, created_at desc);

-- =========================================================================
-- 9. Activity log — what the dashboard's "recent activity" reads.
--    Written by triggers so it cannot be forgotten or forged from a client.
-- =========================================================================
create table if not exists public.activity_log (
    id         bigint generated always as identity primary key,
    kind       text not null check (kind in ('order', 'call', 'bill', 'table')),
    table_id   smallint,
    text_ar    text not null,
    text_en    text not null,
    actor      uuid,
    at         timestamptz not null default now()
);

create index if not exists activity_recent_idx on public.activity_log (at desc);

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_table_name = 'orders' then
        insert into public.activity_log (kind, table_id, text_ar, text_en, actor)
        values ('order', new.table_id,
                case when new.source = 'staff' then 'طلب يدوي' else 'طلب جديد' end,
                case when new.source = 'staff' then 'Manual order' else 'New order' end,
                auth.uid());

    elsif tg_table_name = 'service_calls' then
        insert into public.activity_log (kind, table_id, text_ar, text_en, actor)
        values ('call', new.table_id, 'طلب ويتر', 'Waiter called', auth.uid());

    elsif tg_table_name = 'bills' then
        insert into public.activity_log (kind, table_id, text_ar, text_en, actor)
        values ('bill', new.table_id, 'طلب فاتورة', 'Bill requested', auth.uid());

    elsif tg_table_name = 'sessions' then
        insert into public.activity_log (kind, table_id, text_ar, text_en, actor)
        values ('table', new.table_id,
                case when new.status = 'closed' then 'تم إخلاء الطاولة' else 'جلسة جديدة' end,
                case when new.status = 'closed' then 'Table cleared' else 'Table seated' end,
                auth.uid());
    end if;
    return null;
end;
$$;

drop trigger if exists orders_log on public.orders;
create trigger orders_log after insert on public.orders
    for each row execute function public.log_activity();

drop trigger if exists calls_log on public.service_calls;
create trigger calls_log after insert on public.service_calls
    for each row execute function public.log_activity();

drop trigger if exists bills_log on public.bills;
create trigger bills_log after insert on public.bills
    for each row execute function public.log_activity();

drop trigger if exists sessions_log on public.sessions;
create trigger sessions_log after insert on public.sessions
    for each row execute function public.log_activity();

-- =========================================================================
-- 10. Row level security
-- =========================================================================
alter table public.table_secrets enable row level security;
alter table public.staff         enable row level security;
alter table public.settings      enable row level security;
alter table public.categories    enable row level security;
alter table public.items         enable row level security;
alter table public.tables        enable row level security;
alter table public.sessions      enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.service_calls enable row level security;
alter table public.bills         enable row level security;
alter table public.activity_log  enable row level security;

-- --- staff ---------------------------------------------------------------
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff
    for select to authenticated
    using (id = auth.uid() or public.is_staff());

drop policy if exists staff_manage on public.staff;
create policy staff_manage on public.staff
    for all to authenticated
    using (public.is_manager()) with check (public.is_manager());

-- --- settings: everyone reads the restaurant, staff edits it -------------
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings
    for select to anon, authenticated using (true);

drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings
    for update to authenticated
    using (public.is_staff()) with check (public.is_staff());

-- --- menu: the guest sees what is not hidden -----------------------------
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories
    for select to anon, authenticated
    using (not hidden or public.is_staff());

drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
    for all to authenticated
    using (public.is_staff()) with check (public.is_staff());

drop policy if exists items_read on public.items;
create policy items_read on public.items
    for select to anon, authenticated
    using (not hidden or public.is_staff());

drop policy if exists items_write on public.items;
create policy items_write on public.items
    for all to authenticated
    using (public.is_staff()) with check (public.is_staff());

-- --- tables --------------------------------------------------------------
drop policy if exists tables_read on public.tables;
create policy tables_read on public.tables
    for select to anon, authenticated using (true);

drop policy if exists tables_write on public.tables;
create policy tables_write on public.tables
    for all to authenticated
    using (public.is_staff()) with check (public.is_staff());

-- QR tokens: the dashboard prints them, nobody else ever sees them.
drop policy if exists secrets_staff on public.table_secrets;
create policy secrets_staff on public.table_secrets
    for all to authenticated
    using (public.is_staff()) with check (public.is_staff());

-- --- sessions: my own seating, or anything if I work here ----------------
drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions
    for select to authenticated
    using (created_by = auth.uid() or public.is_staff());

drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
    for insert to authenticated
    with check (created_by = auth.uid());

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
    for update to authenticated
    using (created_by = auth.uid() or public.is_staff())
    with check (created_by = auth.uid() or public.is_staff());

-- --- orders --------------------------------------------------------------
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
    for select to authenticated
    using (created_by = auth.uid() or public.is_staff());

-- A guest may only add a ticket to a session that is theirs and still open.
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
    for insert to authenticated
    with check (
        created_by = auth.uid()
        and exists (
            select 1 from public.sessions s
            where s.id = session_id
              and s.status = 'open'
              and (s.created_by = auth.uid() or public.is_staff())
        )
    );

-- Only the floor moves a ticket forward.
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
    for update to authenticated
    using (public.is_staff()) with check (public.is_staff());

drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items
    for select to authenticated
    using (exists (
        select 1 from public.orders o
        where o.id = order_id and (o.created_by = auth.uid() or public.is_staff())
    ));

drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items
    for insert to authenticated
    with check (exists (
        select 1 from public.orders o
        where o.id = order_id and (o.created_by = auth.uid() or public.is_staff())
    ));

drop policy if exists order_items_write on public.order_items;
create policy order_items_write on public.order_items
    for all to authenticated
    using (public.is_staff()) with check (public.is_staff());

-- --- service calls -------------------------------------------------------
drop policy if exists calls_read on public.service_calls;
create policy calls_read on public.service_calls
    for select to authenticated
    using (created_by = auth.uid() or public.is_staff());

drop policy if exists calls_insert on public.service_calls;
create policy calls_insert on public.service_calls
    for insert to authenticated
    with check (
        created_by = auth.uid()
        and exists (select 1 from public.sessions s where s.id = session_id and s.status = 'open')
    );

drop policy if exists calls_update on public.service_calls;
create policy calls_update on public.service_calls
    for update to authenticated
    using (created_by = auth.uid() or public.is_staff())
    with check (created_by = auth.uid() or public.is_staff());

-- --- bills ---------------------------------------------------------------
drop policy if exists bills_read on public.bills;
create policy bills_read on public.bills
    for select to authenticated
    using (created_by = auth.uid() or public.is_staff());

drop policy if exists bills_insert on public.bills;
create policy bills_insert on public.bills
    for insert to authenticated
    with check (
        created_by = auth.uid()
        and exists (select 1 from public.sessions s where s.id = session_id and s.status = 'open')
    );

drop policy if exists bills_update on public.bills;
create policy bills_update on public.bills
    for update to authenticated
    using (public.is_staff()) with check (public.is_staff());

-- --- activity log: back of house only ------------------------------------
drop policy if exists activity_read on public.activity_log;
create policy activity_read on public.activity_log
    for select to authenticated using (public.is_staff());

-- =========================================================================
-- 11. Realtime — what the three interfaces subscribe to
-- =========================================================================
do $$
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
    end if;
end
$$;

-- Added one by one and skipped if already there, so this file stays re-runnable.
do $$
declare
    t text;
begin
    foreach t in array array[
        'settings', 'categories', 'items', 'tables', 'sessions',
        'orders', 'order_items', 'service_calls', 'bills', 'activity_log'
    ] loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end
$$;

-- Realtime sends old row values for updates/deletes only with a replica
-- identity; the consoles diff on the new row, but deletes need the key.
alter table public.orders        replica identity default;
alter table public.service_calls replica identity default;
alter table public.bills         replica identity default;

-- =========================================================================
-- 12. Convenience for the dashboard
-- =========================================================================

-- Seating a table is the one thing a guest device does that needs checking,
-- so it goes through a function instead of a raw insert: it validates the
-- table, enforces the QR token when the owner turns that on, and reuses the
-- session this device already has instead of opening a second one.
create or replace function public.open_session(
    p_table  smallint,
    p_token  uuid default null,
    p_guests smallint default 2
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
    s            public.sessions;
    needs_token  boolean;
begin
    if auth.uid() is null then
        raise exception 'Sign in before opening a table';
    end if;

    if not exists (select 1 from public.tables t where t.id = p_table and t.active) then
        raise exception 'Unknown table %', p_table;
    end if;

    select qr_required into needs_token from public.settings where id = 1;

    if coalesce(needs_token, false) and not public.is_staff() then
        if not exists (
            select 1 from public.table_secrets ts
            where ts.table_id = p_table and ts.qr_token = p_token
        ) then
            raise exception 'This QR code is not valid for table %', p_table;
        end if;
    end if;

    select * into s
      from public.sessions
     where table_id = p_table and status = 'open' and created_by = auth.uid()
     order by opened_at desc
     limit 1;

    if found then
        if p_guests is not null and p_guests <> s.guests then
            update public.sessions set guests = p_guests where id = s.id returning * into s;
        end if;
        return s;
    end if;

    insert into public.sessions (table_id, guests, created_by, opened_by)
    values (p_table, coalesce(p_guests, 2), auth.uid(),
            case when public.is_staff() then 'staff' else 'guest' end)
    returning * into s;

    return s;
end;
$$;

grant execute on function public.open_session(smallint, uuid, smallint) to anon, authenticated;

-- Promote an existing auth user to staff by e-mail, so nobody has to copy
-- UUIDs by hand:  select public.grant_staff('waiter@lumiere.com', 'Ahmad', 'waiter');
create or replace function public.grant_staff(user_email text, full_name text, member_role text default 'waiter')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    uid uuid;
begin
    select id into uid from auth.users where email = lower(user_email);
    if uid is null then
        raise exception 'No auth user with e-mail %. Create it in Authentication → Users first.', user_email;
    end if;

    insert into public.staff (id, full_name, role)
    values (uid, full_name, member_role)
    on conflict (id) do update set full_name = excluded.full_name,
                                   role = excluded.role,
                                   active = true;
    return uid;
end;
$$;

revoke all on function public.grant_staff(text, text, text) from public, anon, authenticated;

-- Today's numbers for the dashboard's overview cards. security_invoker keeps
-- the view honest: it reads through the caller's RLS, so only staff see real
-- totals instead of the view owner's unrestricted view of every order.
create or replace view public.v_today_stats
with (security_invoker = true) as
    select
        count(*) filter (where o.status <> 'rejected')                    as orders_today,
        coalesce(sum(o.total) filter (where o.status <> 'rejected'), 0)   as revenue_today,
        (select count(*) from public.sessions s where s.status = 'open')  as active_tables
    from public.orders o
    where o.placed_at >= date_trunc('day', now());

grant select on public.v_today_stats to authenticated;
