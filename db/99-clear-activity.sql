-- =========================================================================
-- Wipe a service day: every session, ticket, call and bill.
-- The menu, the tables, the settings and the staff all stay.
--
-- Run it after a demo, or at any point where the floor should start clean.
-- =========================================================================

truncate table
    public.order_items,
    public.orders,
    public.service_calls,
    public.bills,
    public.sessions,
    public.activity_log
restart identity cascade;

-- Ticket codes start from A00 again.
alter sequence public.order_code_seq restart with 1;
