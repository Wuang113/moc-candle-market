alter table public.orders add column discount numeric(12,0) not null default 0;
alter table public.orders add column promo_code text;

create policy "admins read all profiles" on public.profiles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create index if not exists idx_orders_user on public.orders(user_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_created on public.orders(created_at desc);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_order_events_order on public.order_events(order_id);