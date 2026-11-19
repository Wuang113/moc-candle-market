-- =============================
-- Hệ thống TMĐT Nến Hương Mộc
-- =============================

-- Vai trò
create type public.app_role as enum ('admin', 'moderator', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- Hồ sơ khách hàng
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Danh mục sản phẩm (dùng cho bộ lọc/trình bày)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  created_at timestamptz not null default now()
);

-- Phương thức vận chuyển (tạo TRƯỚC orders vì orders tham chiếu)
create table public.shipping_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  fee numeric(12,0) not null,
  eta_days integer not null default 3,
  active boolean not null default true
);

-- Địa chỉ giao hàng của khách
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_name text not null,
  phone text not null,
  province text not null,
  district text not null,
  ward text not null,
  street text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- Trạng thái đơn hàng / thanh toán / phương thức
create type public.order_status as enum ('pending','confirmed','packing','shipping','delivered','cancelled');
create type public.payment_method as enum ('cod','bank_transfer','ewallet');
create type public.payment_status as enum ('unpaid','paid','refunded');

-- Đơn hàng
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid references public.profiles(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  province text not null,
  district text not null,
  ward text not null,
  street text not null,
  note text,
  shipping_method_id uuid references public.shipping_methods(id),
  shipping_fee numeric(12,0) not null default 0,
  subtotal numeric(12,0) not null default 0,
  total numeric(12,0) not null default 0,
  status public.order_status not null default 'pending',
  payment_method public.payment_method not null default 'cod',
  payment_status public.payment_status not null default 'unpaid',
  shopify_cart_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chi tiết đơn hàng (snapshot sản phẩm tại thời điểm đặt)
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_handle text not null,
  product_title text not null,
  variant_title text,
  variant_id text,
  image_url text,
  unit_price numeric(12,0) not null,
  quantity integer not null check (quantity > 0)
);

-- Dòng thời gian xử lý / vận chuyển đơn hàng
create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Thanh toán (mô phỏng: COD / chuyển khoản / ví)
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method public.payment_method not null,
  status public.payment_status not null default 'unpaid',
  amount numeric(12,0) not null,
  transaction_ref text,
  created_at timestamptz not null default now()
);

-- Mã giảm giá đơn giản (quản trị tạo, khách áp khi đặt hàng)
create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_percent integer not null check (discount_percent between 1 and 100),
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- =============================
-- GRANT
-- =============================
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

grant select on public.categories to anon, authenticated;
grant all on public.categories to service_role;
grant insert, update, delete on public.categories to authenticated;

grant all on public.addresses to authenticated;
grant all on public.addresses to service_role;

grant insert on public.orders to anon, authenticated;
grant select, update on public.orders to authenticated;
grant all on public.orders to service_role;

grant insert on public.order_items to anon, authenticated;
grant select on public.order_items to authenticated;
grant all on public.order_items to service_role;

grant select on public.order_events to authenticated;
grant insert, update on public.order_events to authenticated;
grant all on public.order_events to service_role;

grant insert, select on public.payments to authenticated;
grant all on public.payments to service_role;

grant select on public.shipping_methods to anon, authenticated;
grant all on public.shipping_methods to service_role;
grant insert, update, delete on public.shipping_methods to authenticated;

grant select on public.promo_codes to authenticated;
grant all on public.promo_codes to service_role;
grant insert, update, delete on public.promo_codes to authenticated;

-- =============================
-- RLS
-- =============================
alter table public.user_roles enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.payments enable row level security;
alter table public.shipping_methods enable row level security;
alter table public.promo_codes enable row level security;

create policy "roles readable by owner" on public.user_roles
  for select to authenticated using (user_id = auth.uid());
create policy "admins read all roles" on public.user_roles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create policy "own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "categories public read" on public.categories
  for select using (true);
create policy "admins manage categories" on public.categories
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "own addresses" on public.addresses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "guest can create order" on public.orders
  for insert to anon with check (user_id is null);
create policy "user can create own order" on public.orders
  for insert to authenticated with check (user_id = auth.uid() or user_id is null);
create policy "owner reads order" on public.orders
  for select to authenticated using (user_id = auth.uid());
create policy "admins manage all orders" on public.orders
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "guest can add items" on public.order_items
  for insert to anon with check (true);
create policy "user can add items" on public.order_items
  for insert to authenticated with check (true);
create policy "owner reads items" on public.order_items
  for select to authenticated using (exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()
  ));
create policy "admins manage items" on public.order_items
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "owner reads events" on public.order_events
  for select to authenticated using (exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()
  ));
create policy "admins manage events" on public.order_events
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "owner reads payments" on public.payments
  for select to authenticated using (exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()
  ));
create policy "owner creates payment" on public.payments
  for insert to authenticated with check (exists (
    select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  ));
create policy "admins manage payments" on public.payments
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "shipping methods public read" on public.shipping_methods
  for select using (true);
create policy "admins manage shipping methods" on public.shipping_methods
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "promo readable" on public.promo_codes
  for select to authenticated using (true);
create policy "admins manage promo" on public.promo_codes
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- =============================
-- Số đơn hàng tự sinh + updated_at
-- =============================
create or replace function public.generate_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := 'ANN' || to_char(now(), 'YYMMDD') || lpad((floor(random() * 100000))::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger trg_order_number
before insert on public.orders
for each row execute function public.generate_order_number();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_orders_touch
before update on public.orders
for each row execute function public.touch_updated_at();

-- =============================
-- Dữ liệu khởi tạo
-- =============================
insert into public.categories (name, slug, description) values
  ('Nến trong lọ', 'nen-trong-lo', 'Nến đậu nành trong lọ thủy tinh, gốm men tinh tế'),
  ('Nến gốm sứ', 'nen-gom-su', 'Nến gốm men thủ công, có thể tái sử dụng làm chậu'),
  ('Nến trụ', 'nen-tru', 'Nến trụ tạo hình thanh lịch cho bàn ăn và trang trí'),
  ('Bộ quà tặng', 'bo-qua-tang', 'Bộ quà tặng nến hương đóng hộp sang trọng'),
  ('Nến du lịch', 'nen-du-lich', 'Nến thiếc nhỏ gọn mang đi du lịch, làm quà'),
  ('Nến đất nung', 'nen-dat-nung', 'Nến đất nung mộc mạc phong cách Việt');

insert into public.shipping_methods (name, description, fee, eta_days) values
  ('Giao hàng tiêu chuẩn', 'Giao toàn quốc 2-5 ngày', 25000, 4),
  ('Giao hàng nhanh', 'Giao nội thành 1-2 ngày', 35000, 2),
  ('Giao hàng hỏa tốc', 'Giao trong ngày tại TP.HCM & Hà Nội', 55000, 1),
  ('Nhận tại cửa hàng', 'Nhận tại shop 149 Nguyễn Văn Cừ, TP.HCM', 0, 0);

insert into public.promo_codes (code, discount_percent, expires_at) values
  ('ANNHIEN10', 10, now() + interval '90 days');
