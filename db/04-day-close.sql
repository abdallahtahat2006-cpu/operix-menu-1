-- =========================================================================
-- Operix Restaurant System — closing a table, closing a day
-- Run after 01-schema.sql (and any time after; it only adds).
--
-- Closing a table now really empties it: the tickets, the calls and the bill
-- are deleted, not archived in place. But a restaurant cannot throw away
-- what it sold, so every session is first compressed into one `receipts`
-- row — totals plus a per-dish breakdown — and that row is what the
-- dashboard's day, week and month figures are built from.
--
-- The floor therefore only ever holds the tables sitting in it right now,
-- and history stays small enough to keep forever.
-- =========================================================================

-- Which local midnight counts as "a new day" for this restaurant.
alter table public.settings
    add column if not exists timezone text not null default 'Asia/Amman';

-- =========================================================================
-- 1. Receipts — the permanent record
-- =========================================================================
create table if not exists public.receipts (
    id            uuid primary key default gen_random_uuid(),
    table_id      smallint,
    session_id    uuid,

    opened_at     timestamptz,
    closed_at     timestamptz not null default now(),

    guests        smallint not null default 0,
    orders_count  integer not null default 0,
    items_count   integer not null default 0,

    subtotal      numeric(10,2) not null default 0,
    service       numeric(10,2) not null default 0,
    total         numeric(10,2) not null default 0,
    method        text,                                  -- how they paid, if they said

    -- [{id, ar, en, qty, total}] — enough for "most ordered" without keeping
    -- every ticket line for years.
    lines         jsonb not null default '[]'::jsonb,

    closed_by     uuid references public.staff (id) on delete set null
);

create index if not exists receipts_closed_idx on public.receipts (closed_at desc);
create index if not exists receipts_table_idx  on public.receipts (table_id, closed_at desc);

alter table public.receipts enable row level security;

drop policy if exists receipts_read on public.receipts;
create policy receipts_read on public.receipts
    for select to authenticated using (public.is_staff());

-- Written only by the functions below, which run as the owner.
drop policy if exists receipts_write on public.receipts;
create policy receipts_write on public.receipts
    for all to authenticated using (false) with check (false);

-- =========================================================================
-- 2. Archiving one session
-- =========================================================================
create or replace function public.archive_session(p_session uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    s         public.sessions;
    pct       numeric;
    body      jsonb;
    sub       numeric := 0;
    n_orders  integer := 0;
    n_items   integer := 0;
    pay       text;
    receipt   uuid;
begin
    select * into s from public.sessions where id = p_session;
    if not found then return null; end if;

    select coalesce(service_pct, 0) into pct from public.settings where id = 1;

    select
        coalesce(jsonb_agg(x), '[]'::jsonb),
        coalesce(sum(x.total), 0),
        coalesce(sum(x.qty), 0)
    into body, sub, n_items
    from (
        select
            oi.item_id                    as id,
            min(oi.name_ar)               as ar,
            min(oi.name_en)               as en,
            sum(oi.qty)::int              as qty,
            sum(oi.qty * oi.unit_price)   as total
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where o.session_id = p_session
          and o.status <> 'rejected'
        group by oi.item_id
    ) x;

    select count(*) into n_orders
      from public.orders
     where session_id = p_session and status <> 'rejected';

    select method into pay
      from public.bills
     where session_id = p_session
     order by created_at desc
     limit 1;

    -- A table that sat down and never ordered leaves no receipt behind.
    if n_orders = 0 then
        return null;
    end if;

    insert into public.receipts (
        table_id, session_id, opened_at, closed_at, guests,
        orders_count, items_count, subtotal, service, total, method, lines, closed_by
    ) values (
        s.table_id, s.id, s.opened_at, now(), s.guests,
        n_orders, n_items, sub, round(sub * pct, 2), round(sub * (1 + pct), 2),
        pay, body, case when public.is_staff() then auth.uid() else null end
    )
    returning id into receipt;

    return receipt;
end;
$$;

-- =========================================================================
-- 3. Closing a table — archive, then delete everything it holds
--    Deleting the session cascades to its orders, order lines, calls and
--    bills, so one delete empties the table completely.
-- =========================================================================
create or replace function public.close_table(p_table smallint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    row_session public.sessions;
    kept        integer := 0;
begin
    if not public.is_staff() then
        raise exception 'Only staff can close a table';
    end if;

    for row_session in
        select * from public.sessions where table_id = p_table and status = 'open'
    loop
        if public.archive_session(row_session.id) is not null then
            kept := kept + 1;
        end if;
        delete from public.sessions where id = row_session.id;
    end loop;

    return kept;
end;
$$;

-- =========================================================================
-- 4. Closing the day
--    Everything opened before the restaurant's local midnight is archived
--    and cleared, so the floor console starts each day empty on its own.
--    Only sessions and what hangs off them are touched — the menu, the
--    tables, the settings and the staff are never part of this.
-- =========================================================================
create or replace function public.end_day()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    tz          text;
    day_start   timestamptz;
    row_session public.sessions;
    cleared     integer := 0;
begin
    if not public.is_staff() then
        raise exception 'Only staff can close the day';
    end if;

    select coalesce(timezone, 'Asia/Amman') into tz from public.settings where id = 1;
    day_start := date_trunc('day', (now() at time zone tz)) at time zone tz;

    for row_session in
        select * from public.sessions where opened_at < day_start
    loop
        perform public.archive_session(row_session.id);
        delete from public.sessions where id = row_session.id;
        cleared := cleared + 1;
    end loop;

    -- Yesterday's log lines are noise on today's dashboard.
    delete from public.activity_log where at < day_start;

    return cleared;
end;
$$;

grant execute on function public.close_table(smallint) to authenticated;
grant execute on function public.end_day() to authenticated;
revoke all on function public.archive_session(uuid) from public, anon, authenticated;

-- =========================================================================
-- 5. What the dashboard reads
-- =========================================================================

-- One row per served day. security_invoker keeps it behind the same RLS as
-- the receipts themselves.
create or replace view public.v_stats_daily
with (security_invoker = true) as
select
    (r.closed_at at time zone coalesce((select timezone from public.settings where id = 1), 'Asia/Amman'))::date as day,
    count(*)::int                as tables_served,
    coalesce(sum(r.guests), 0)::int       as guests,
    coalesce(sum(r.orders_count), 0)::int as orders,
    coalesce(sum(r.total), 0)             as revenue
from public.receipts r
group by 1
order by 1 desc;

grant select on public.v_stats_daily to authenticated;

-- Most ordered dishes over a window, straight out of the receipt lines.
create or replace function public.top_dishes(p_days integer default 7)
returns table (id text, ar text, en text, qty bigint, total numeric)
language sql
stable
as $$
    select
        (l ->> 'id')::text            as id,
        min(l ->> 'ar')               as ar,
        min(l ->> 'en')               as en,
        sum((l ->> 'qty')::bigint)    as qty,
        sum((l ->> 'total')::numeric) as total
    from public.receipts r,
         lateral jsonb_array_elements(coalesce(r.lines, '[]'::jsonb)) l
    where r.closed_at >= now() - make_interval(days => p_days)
    group by 1
    order by 4 desc
    limit 10;
$$;

grant execute on function public.top_dishes(integer) to authenticated;
