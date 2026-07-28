# Private hosting setup

The page contains a hotel confirmation number, exact dates away from home,
employer details and a personal budget. It should not be publicly reachable.

Target setup: **private repo → Cloudflare Pages → Cloudflare Access (email login)**.

Cloudflare Access protects the *site*. It does nothing about the *repository* —
if the repo stays public the same data is still readable on GitHub. Both halves
are required.

## 1. Take the current site down

GitHub → repo → **Settings**

1. **Pages** → Source → **None**. This stops `mikom92.github.io/bay-area-trip`.
2. **General** → Danger Zone → **Change visibility** → **Private**.

The old URL was public and indexed. Google may serve a cached copy for a while;
removal can be requested at <https://search.google.com/search-console/remove-outdated-content>
without owning the property.

## 2. Deploy to Cloudflare Pages

1. Sign up / log in at <https://dash.cloudflare.com>.
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Authorise Cloudflare for GitHub and pick `mikom92/bay-area-trip`.
   Private repos work on the free plan.
4. Build settings — this is a plain static file, so:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/`
5. **Save and Deploy** → gives a `https://<project>.pages.dev` URL.

At this point the site is live but still open to anyone with the link. Do not
stop here.

## 3. Put a login in front of it

Cloudflare dashboard → **Zero Trust** (first visit asks you to pick a team name
and a plan — choose **Free**, which covers up to 50 users).

1. **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application domain: the `<project>.pages.dev` hostname from step 2.
3. Add a policy:
   - Action: **Allow**
   - Include → **Emails** → your address (add others the same way)
4. Identity provider: **One-time PIN** is enabled by default and needs no setup —
   it emails a code on each login. Google/GitHub SSO can be added later if you
   prefer.
5. Save.

If the dashboard refuses to attach Access to a `pages.dev` hostname, attach a
custom domain to the Pages project first (**Custom domains** tab) using a domain
in your Cloudflare account, and point the Access application at that instead.

## 4. Verify

Open the URL in a private window. You should get a Cloudflare login prompt, not
the trip page. Enter the emailed code and confirm the page loads and the map
links still work.

## Notes

- `_headers` sets the CSP and related headers. Cloudflare Pages reads this file
  automatically; GitHub Pages ignores it. The policy is tight (`default-src
  'none'`) and allows exactly what the page uses: Google Fonts, the Frankfurter
  FX endpoint, inline CSS/JS and a data-URI favicon. Adding any new external
  resource means updating it or the browser will silently block the resource.
- Deploys are automatic on every push to `main`.
- The confirmation number was publicly readable while the site was on GitHub
  Pages. A confirmation number cannot be rotated like a password — worth keeping
  in mind rather than acting on.
