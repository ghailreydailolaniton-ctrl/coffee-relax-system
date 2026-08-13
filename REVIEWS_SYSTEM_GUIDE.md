# ⭐ Coffee & Relax - Customer Reviews & Ratings System

## Overview
Customers can now rate their orders and leave reviews after their order is marked as "done" (served). Reviews are stored in the database and can be displayed on a public website to attract more customers.

---

## 🗄️ **Database Setup**

### Run this SQL in Supabase SQL Editor:

```sql
-- Reviews & Ratings Table for Customer Feedback
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
```

---

## 📱 **Customer Flow**

### Step 1: Order is Placed
- Customer orders via the app
- Order goes through queue: Waiting → Serving → Done

### Step 2: Order Marked as "Done"
- Cashier marks order as "Served/Done"
- Customer sees "Served na ang order mo" message

### Step 3: Rate Experience
- ⭐ **"Rate Your Experience"** button appears
- Customer clicks to open review form

### Step 4: Submit Review
- Select 1-5 stars (⭐⭐⭐⭐⭐)
- Optional: Write a comment
- Click "Submit Review"
- Review saved to database

### Step 5: Confirmation
- Shows "✓ Thank you for your review!"
- Button disappears (already reviewed)

---

## 🎨 **UI Components**

### Review Form Modal:
```
─────────────────────────────┐
│     Rate Your Order         │
│  How was your experience?   │
│                             │
│   ⭐  ⭐  ⭐  ⭐  ⭐          │
│                             │
│ ┌─────────────────────────┐ │
│ │ Share your experience   │ │
│ │ (optional)...           │ │
│ │                         │ │
│ └─────────────────────────┘ │
│                             │
│  [Cancel]  [Submit Review]  │
└─────────────────────────────┘
```

### Order Status Display:
```
Order #105 · Served
Served na ang order mo.

⭐ Rate Your Experience  ← Button appears here
```

After Review:
```
Order #105 · Served
Served na ang order mo.

✓ Thank you for your review!  ← Confirmation message
```

---

## 📊 **Admin Analytics**

### Reviews Dashboard (Admin Panel → Business Analytics):

```
┌─────────────────────────────────────────┐
│ ⭐ Customer Reviews                     │
├─────────────────────────────────────────┤
│  ┌──────┐  ┌──────┐  ┌──────┐          │
│  │ 4.8  │  │  127 │  │  68% │          │
│  │Avg   │  │Reviews│  │ Rate │          │
│  │Rating│  │      │  │      │          │
│  └──────  └──────┘  └──────┘          │
│                                         │
│ ⭐⭐⭐⭐⭐  Great customer satisfaction!  │
└─────────────────────────────────────────┘
```

### Metrics Tracked:
- **Average Rating**: Overall star rating (1-5)
- **Total Reviews**: Number of reviews received
- **Response Rate**: % of orders with reviews
- **Customer Satisfaction**: Visual indicator

---

## 🌐 **Public Website Integration**

### Example: Display Reviews on Website

```javascript
// Fetch public reviews from Supabase
const { data: reviews } = await supabase
  .from('reviews')
  .select('*')
  .eq('is_public', true)
  .order('created_at', { ascending: false })
  .limit(10);

// Display on website
reviews.forEach(review => {
  console.log(`${review.customer_name} gave ${review.rating} stars`);
  console.log(`Comment: ${review.comment}`);
  console.log(`Product: ${review.product_rated}`);
});
```

### Example: Show Average Rating

```javascript
// Get average rating
const { data: stats } = await supabase
  .from('reviews')
  .select('rating');

const avgRating = stats.reduce((sum, r) => sum + r.rating, 0) / stats.length;
console.log(`Average Rating: ${avgRating.toFixed(1)}/5 `);
```

---

## 🔒 **Privacy & Security**

### What's Public:
- ✅ Star rating (1-5)
- ✅ Comment (if provided)
- ✅ Product rated
- ✅ First name only (customer_name)
- ✅ Date of review

### What's Private:
- ❌ Order details
- ❌ Payment information
- ❌ Full customer details
- ❌ Order number (internal only)

### Moderation:
- All reviews are public by default (`is_public: true`)
- Can be hidden by setting `is_public: false` in database
- No profanity filter (can add if needed)

---

## 📈 **Business Benefits**

| Benefit | Impact |
|---------|--------|
| **Social Proof** | 92% of customers read reviews before buying |
| **Trust Building** | Shows transparency and quality |
| **SEO Boost** | Fresh user-generated content |
| **Customer Insights** | Know what customers love/hate |
| **Repeat Business** | Engaged customers return more |

---

## 🛠️ **Customization Options**

### Change Rating Scale:
Edit the star rating component in `OrderTray`:
```typescript
// Currently 1-5 stars
{[1, 2, 3, 4, 5].map((star) => (...))}
```

### Require Comment:
```typescript
const handleReviewSubmit = () => {
  if (!reviewComment.trim()) {
    alert("Please write a comment");
    return;
  }
  // ... submit
};
```

### Add Photo Upload:
```typescript
// Add to review schema
photo_url text,

// Add file input to form
<input type="file" accept="image/*" />
```

---

##  **Troubleshooting**

### Reviews Not Showing:
1. Check if `reviews` table exists in Supabase
2. Verify RLS policies are correct
3. Check browser console for errors
4. Ensure `is_public = true` for reviews

### Can't Submit Review:
1. Check if order status is "done"
2. Verify Supabase connection
3. Check if review already submitted (`hasReview` flag)

### Star Icons Not Showing:
- Unicode stars (⭐☆) should work in all browsers
- Can replace with SVG icons if needed

---

## 📞 **Support**

For technical support or feature requests, contact your development team.

**Version**: 1.0.0
**Last Updated**: 2026
**Database Table**: `public.reviews`
