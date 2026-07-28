# Hosting setup

Two versions of the same trip, one deployment:

| Path | Contents | Who can see it |
|---|---|---|
| `/` | General route: days, places, map links, travel notes | Anyone |
| `/full` | Everything — dates, flights, bookings, confirmation number, budget console, checklist | Only you, via email login |

```
index.html          public itinerary
full/index.html     personal version
assets/style.css    shared stylesheet, both pages use it
_headers            CSP and hardening; noindex on /full
robots.txt          keeps /full out of search indexes
```

**The repository has to be private.** Cloudflare Access protects the *site*;
it does nothing about the *repo*. If the repo stays public, everything in
`full/index.html` is readable straight from GitHub regardless of Access.

## 1. Take the current site down

GitHub → repo → **Settings**

1. **Pages** → Source → **None**. This stops `mikom92.github.io/bay-area-trip`,
   which currently serves the full version publicly.
2. **General** → Danger Zone → **Change visibility** → **Private**.

The old URL was public and indexed. Google may serve a cached copy for a while;
removal can be requested at
<https://search.google.com/search-console/remove-outdated-content>.

## 2. Deploy to Cloudflare Pages

1. Sign up / log in at <https://dash.cloudflare.com>.
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Authorise Cloudflare for GitHub and pick `mikom92/bay-area-trip`.
   Private repos work on the free plan.
4. Build settings — plain static files, nothing to build:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/`
5. **Save and Deploy** → gives `https://<project>.pages.dev`.

Both versions are now live and **both are open to anyone with the link**. The
next step is what closes `/full`.

## 3. Put a login in front of /full only

Cloudflare dashboard → **Zero Trust** (first visit asks for a team name and a
plan — choose **Free**, which covers up to 50 users).

1. **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application domain:
   - Subdomain/domain: the `<project>.pages.dev` hostname
   - **Path: `full`** ← this is the important part. Leave it empty and you lock
     the public itinerary too.
3. Add a policy:
   - Action: **Allow**
   - Include → **Emails** → your address (add others the same way)
4. Identity provider: **One-time PIN** is on by default and needs no setup — it
   emails a code at each login. Google or GitHub SSO can be added later.
5. Save.

If the dashboard will not attach Access to a `pages.dev` hostname, add a custom
domain to the Pages project first (**Custom domains** tab) using a domain in
your Cloudflare account, and point the Access application at that.

## 4. Verify

In a private window:

- `https://<project>.pages.dev/` → the public itinerary loads, no login.
- `https://<project>.pages.dev/full` → Cloudflare login prompt, **not** the page.

Then log in with the emailed code and check the full version loads, the budget
console still calculates and the map links open.

## Notes

- Deploys are automatic on every push to `main`.
- `_headers` sets a strict CSP (`default-src 'none'`) allowing exactly what the
  pages use: Google Fonts, the Frankfurter FX endpoint, inline CSS/JS, the
  shared stylesheet and a data-URI favicon. Any new external resource needs a
  matching entry or the browser will silently block it.
- Both pages share `assets/style.css`, so a design change applies to both.
  Content is deliberately not shared — the public version is a separate file so
  personal details cannot leak into it by accident.
- The confirmation number was publicly readable while the full version was on
  GitHub Pages. A confirmation number cannot be rotated like a password — worth
  knowing rather than acting on.
