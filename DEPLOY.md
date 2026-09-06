# Deploying this page

Static hosting, nothing to build — the whole trip is one `index.html`, plus a
shared stylesheet, a service worker and a manifest for offline/PWA use.

## Architecture

The route, places and budget console are in the page and public. The hotel
name, confirmation code, confirmed costs and the second-stay booking are
**not in this file at all** — they live in a Supabase table (`trip_private`)
that Row Level Security exposes only to a signed-in owner. Viewing the page
source shows nothing private; hiding an element client-side would have shipped
the data anyway, so the data simply is not fetched until sign-in.

This trip shares its Supabase project and the `trip_private` table with the
Costa Rica trip page — one sign-in works for both, and adding this trip's rows
needed no new policy, since the existing owner-only policy covers every row in
the table regardless of key prefix.

## Tests

```
node --test
```

Run it from the repository root, with no path argument — `node --test tests/`
looks for a *module* called `tests` and fails with `Cannot find module`.

The suite covers `assets/trip-state.js`, which holds the page's pure logic: the
budget arithmetic, the target band and gauge, which controls belong in a
shareable link, checklist progress, the variant delta and money formatting.
Anything with a number in it belongs there rather than inline in `index.html`,
where it cannot be tested — three of the bugs found so far lived in exactly
that gap.

## GitHub Pages

1. Repo → **Settings → General** → make sure visibility is **Public**. There
   is nothing sensitive in this repository to protect — the split described
   above is what makes that safe.
2. **Settings → Pages** → Source: **Deploy from a branch** → `main` / `/ (root)`.
3. Site is live at `https://<user>.github.io/<repo>/`.

## Supabase — private trip details

Run once, in the Supabase SQL editor (idempotent — safe to re-run):

```sql
create table if not exists public.trip_private (
  key   text primary key,
  value text not null
);

alter table public.trip_private enable row level security;

drop policy if exists "owner reads" on public.trip_private;
create policy "owner reads" on public.trip_private
  for select to authenticated
  using (auth.email() = '<your email>');
```

There is deliberately **no insert/update/delete policy**: rows are managed in
the Supabase table editor, so the page can never write to this table even if
someone signs in.

Seed the Bay Area rows (placeholders here — fill in the real values in the
Supabase editor, not in this file, since this repository is public):

```sql
insert into public.trip_private (key, value) values
  ('bay.hotel.name',           '<hotel name>'),
  ('bay.hotel.code',           '<confirmation code>'),
  ('bay.budget.lodgingTotal',  '<confirmed total, PLN, digits only>'),
  ('bay.budget.lodgingNights', '<nights the total covers>'),
  ('bay.budget.lodgingLabel',  '<hotel name>, <city> — <n> nights ✓ booked'),
  ('bay.budget.carLabel',      '<car — confirmed cost and details>'),
  ('bay.budget.carBase',       '<confirmed base rate, USD>'),
  ('bay.budget.carPerDay',     '<confirmed per-extra-day rate, USD>'),
  ('bay.stay2.detail',         '<second-stay booking sentence: who via, property, distance, rewards>'),
  ('bay.la.host',              '<who you are staying with in LA, and why they are there that week>'),
  ('bay.la.hotel',             '<candidate LA hotel — name, address, review read>')
on conflict (key) do update set value = excluded.value;
```

The two `bay.la.*` rows belong to the undecided Variant B (15–17 Sep) and are
the odd ones out here: they gate a *candidate*, not a booking. `bay.la.host`
is behind sign-in for a third party's privacy rather than to protect a
confirmation code — the public page says only that a friend is covering the
hotel. Until these rows exist, that day renders a 🔒 even for a signed-in
owner, which is the correct empty state, not a fault.

`bay.budget.lodgingTotal` / `lodgingNights` are stored as the confirmed total
and its night count rather than a pre-divided rate, so the source figures stay
auditable against the actual confirmation. `bay.budget.carBase` /
`carPerDay` mirror the car rental's tiered rate (a base price for the first
week, then a per-day rate beyond it) — signed out, the budget console shows
round estimates for both instead.

### Checklist sync — the one table the page may write

`trip_private` is read-only to the page and stays that way. The booking
checklist is a different problem: without somewhere to put it, ticking on a
laptop leaves the phone blank. It lives in its own table, so the read-only
property above survives intact.

```sql
create table if not exists public.trip_checklist (
  key        text primary key,
  done       boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.trip_checklist enable row level security;

create policy "owner reads checklist" on public.trip_checklist
  for select to authenticated using (auth.email() = '<your email>');

create policy "owner inserts checklist" on public.trip_checklist
  for insert to authenticated with check (auth.email() = '<your email>');

create policy "owner updates checklist" on public.trip_checklist
  for update to authenticated
  using (auth.email() = '<your email>') with check (auth.email() = '<your email>');
```

No delete policy, and nothing sensitive in the table: booleans keyed by slug,
so a compromised session reaches nothing private. Signed out, the page never
touches it and the checklist is `localStorage` exactly as before. Signed in,
the stored set wins for keys it knows, local ticks fill the gaps and get
pushed, and every later change is written back — last write wins, which is the
right rule for one person on two devices.

### Sign-in

Email magic link, no OAuth app to register and no password:

1. Supabase dashboard → **Authentication → Providers → Email**, enable it.
2. **Authentication → URL Configuration** → add this page's deployed URL to
   the redirect allow-list (alongside the Costa Rica page's URL, if not
   already there). Without this the link in the email will refuse to come
   back.

Click **🔒 Private details** in the footer, or any locked `🔒` value on the
page.

### Verify RLS is actually on

If RLS is left disabled, the publishable key exposes **every** table in the
project, not just this one. Check it:

```sql
select relname, relrowsecurity from pg_class where relname = 'trip_private';
-- relrowsecurity must be true
```

## Offline

`sw.js` caches the page shell for offline use; documents are served
network-first, so an updated itinerary is never masked by a stale cached copy.
After changing `index.html`, bump `VERSION` in `sw.js` so returning visitors
get the new copy instead of the cached one.

## Editing the content

- **Itinerary days** — the `.timeline .day` blocks in `index.html`.
- **Budget console** — the `RATES` object and `recalc()` in the inline
  `<script>`. The two booking-specific rates (car, hotel) start at round
  estimates and are overridden by `Private.applyToBudget()` once the private
  values load.
- **Checklist** — the `.checklist-items` block; `data-key` values are the
  `localStorage` keys, so reordering items is safe, but changing a `data-key`
  resets that one tick.
