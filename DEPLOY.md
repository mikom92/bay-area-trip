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

#### Letting a travelling companion in

This table is shared with the Costa Rica trip, so a second reader is a
*second policy*, never a wider first one. Permissive policies are OR'd, so the
owner's access is untouched and the guest's stands or falls on its own — and
the key prefix keeps the other trip's rows out of reach:

```sql
create policy "bay guest reads" on public.trip_private
  for select to authenticated
  using (auth.email() = '<their email>' and key like 'bay.%');
```

Worth checking with the actual identities rather than reading the policy and
assuming. Set `request.jwt.claims` inside a transaction and count what each one
sees:

| signed in as | `bay.*` | other trip | `trip_checklist` |
|---|---|---|---|
| owner | 11 | 6 | 8 |
| guest | 11 | **0** | **0** |
| anyone else | 0 | 0 | 0 |

The checklist stays the owner's: it is a different table with owner-only
policies, so a guest signing in simply keeps using their own browser's copy.

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

#### Keys the companion must not see

The guest policy is `key like 'bay.%'`, so the prefix is the access control.
A row that only the owner should read simply does not use it:

```sql
insert into public.trip_private (key, value) values
  ('mm.packing.refs', '<every booking reference, one line>')
on conflict (key) do update set value = excluded.value;
```

`mm.packing.refs` backs the one line of the packing list that carries booking
numbers. No new policy was needed — `bay guest reads` cannot match the key, and
`owner reads` matches every row regardless of prefix. Verified per identity:

| signed in as | `mm.packing.refs` | `bay.*` | all rows |
|---|---|---|---|
| owner | **1** | 12 | 19 |
| guest | **0** | 12 | 12 |

Worth knowing how *not* to test this: wrapping `set_config('request.jwt.claims',…)`
in a CTE and selecting alongside it returns every row, because the MCP/SQL-editor
connection runs as a privileged role that bypasses RLS and the CTE's timing
relative to the scan is undefined. It reads like a leak and is not one. Use a
transaction with `set local role authenticated` and one identity per statement.

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
2. **Authentication → URL Configuration**, and set *both* fields:
   - **Site URL** → `https://<user>.github.io/<repo>/`
   - **Redirect URLs** → add `https://<user>.github.io/<repo>/**`
     (alongside the Costa Rica page's URL, if not already there)

   Getting this wrong does not produce an error. Supabase silently falls back
   to the Site URL for any redirect target that is not in the allow-list, and
   an unset Site URL defaults to `http://localhost:3000` — so the magic link
   arrives, opens, and dies on a dead localhost tab with the access token
   sitting in the address bar. If that is what you are seeing, this is the
   setting, not the page.

   The page asks to come back to `location.origin + location.pathname` rather
   than the URL you were on, so the target stays the same whatever `?v=` or
   budget parameters are in the address bar. That is one URL to allow-list
   instead of a family of them.

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
- **Packing list** — the `.packing-cat` blocks. Add a category by copying one:
  the counter and bar are driven by `[data-cat-count]` / `[data-cat-bar]`
  inside it, so nothing needs registering anywhere. Keys are prefixed
  `packing:` and live under their own `bayarea-trip-packing` storage key,
  separate from the booking checklist and deliberately **not** synced to
  Supabase — the list is used at home the night before, often offline, and
  last-write-wins across two devices is a poor trade there.

  The section is shown only to a signed-in visitor, but that gate is
  presentation, not protection: the markup ships to everyone. Anything that
  must not be public — the booking numbers, and the names behind them — is a
  `data-private` span fetched from `trip_private`, exactly like the rest of
  the page. The rule of thumb when adding an item: if it would be a problem
  in a public repository, it does not go in `index.html`.
