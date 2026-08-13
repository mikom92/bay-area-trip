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
  ('bay.stay2.detail',         '<second-stay booking sentence: who via, property, distance, rewards>')
on conflict (key) do update set value = excluded.value;
```

`bay.budget.lodgingTotal` / `lodgingNights` are stored as the confirmed total
and its night count rather than a pre-divided rate, so the source figures stay
auditable against the actual confirmation. `bay.budget.carBase` /
`carPerDay` mirror the car rental's tiered rate (a base price for the first
week, then a per-day rate beyond it) — signed out, the budget console shows
round estimates for both instead.

### Sign-in

Email magic link, no OAuth app to register and no password:

1. Supabase dashboard → **Authentication → Providers → Email**, enable it.
2. **Authentication → URL Configuration** → add this page's deployed URL to
   the redirect allow-list (alongside the Costa Rica page's URL, if not
   already there). Without this the link in the email will refuse to come
   back.

Click **🔒 Private details** in the footer, or any locked `🔒` value on the
page.

If the footer button reads **⚠ your@address · details did not load**, the sign-in
worked but the table did not answer: either `trip_private` is missing, or the
owner policy names a different address than the one signed in. The console names
which. Signed-in-with-nothing and signed-out look the same from the page, so they
are deliberately labelled differently.

### Verify RLS is actually on

If RLS is left disabled, the publishable key exposes **every** table in the
project, not just this one. Check it:

```sql
select relname, relrowsecurity from pg_class where relname = 'trip_private';
-- relrowsecurity must be true
```

## The pinned Supabase build

The sign-in library is loaded from jsDelivr, pinned to an exact version with an
SRI digest:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3"
        integrity="sha384-l8ah+VgaWtk1mvOe9VC+OirC6qHFF4yH7l7mKRidV9MSti3E9F463bMp6ZVN4kuC"
        crossorigin="anonymous" defer></script>
```

This page holds an auth session, so an open `@2` range would hand whatever build
the CDN serves next the keys to it. Bumping is two edits that must be made
together — the version in `src` and the digest — and the digest has to be
generated **from the exact URL in `src`**:

```bash
V=2.112.3   # replace with the version you want
curl -sL "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@$V" \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Do **not** substitute the npm tarball for that URL, however reasonable it looks:
hashing `dist/umd/supabase.js` out of the package yields
`sha384-qafw21c/…`, a different value, because what jsDelivr returns for a bare
pinned package URL is not byte-identical to that file. The Costa Rica page shipped
that mistake to production, where the browser refused the script and the failure
surfaced as an "offline" label pointing at the wifi. If the CDN is unreachable from
where you work, the digest cannot be verified there at all — do it from a machine
that can reach it.

A refused script is not a page-down. The itinerary, budget console and checklist
have all initialised by then; only the private details stay locked. The page says
which fault it hit rather than blaming the connection, and `SB.get()` logs the two
possible causes to the console.

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
  values load. Everything paid in dollars is stored in dollars
  (`SF_DAY_PARKING_USD`, `ATTRACTIONS_USD`, `TASTING_USD`, and the car rates) and
  multiplied by the live rate, so the whole breakdown moves together; the food
  slider is the one figure set in złoty, because it is a złoty-a-day allowance.
- **Checklist** — the `.checklist-items` block; `data-key` values are the
  `localStorage` keys, so reordering items is safe, but changing a `data-key`
  resets that one tick.
