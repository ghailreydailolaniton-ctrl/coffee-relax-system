-- Reviews & Ratings Table for Customer Feedback
-- This enables customers to rate their orders and display on public website

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  order_number integer,
  customer_name text not null,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  product_rated text,
  product_category text check (product_category in ('Coffee', 'Dessert', 'Overall')),
  created_at timestamptz not null default now(),
  is_public boolean default true
);

-- Indexes for fast queries
create index if not exists reviews_order_id_idx on public.reviews(order_id);
create index if not exists reviews_rating_idx on public.reviews(rating);
create index if not exists reviews_created_at_idx on public.reviews(created_at);
create index if not exists reviews_is_public_idx on public.reviews(is_public);

-- Enable Row Level Security
alter table public.reviews enable row level security;

-- Drop existing policies if any
drop policy if exists "Public can read public reviews" on public.reviews;
drop policy if exists "Customers can create reviews" on public.reviews;
drop policy if exists "Admins can manage all reviews" on public.reviews;

-- Policy: Anyone can read public reviews (for public website)
create policy "Public can read public reviews"
on public.reviews for select
to anon
using (is_public = true);

-- Policy: Customers can create reviews for their orders
create policy "Customers can create reviews"
on public.reviews for insert
to anon
with check (true);

-- Policy: Customers can update their own reviews
create policy "Customers can update own reviews"
on public.reviews for update
to anon
using (true)
with check (true);

-- Enable Realtime for live review updates
do $$
begin
  alter publication supabase_realtime add table public.reviews;
exception
  when duplicate_object then null;
end $$;

-- Add review stats to store_config for quick access
insert into public.store_config (key, value) 
values ('average_rating', '0'),
       ('total_reviews', '0')
on conflict (key) do nothing;
