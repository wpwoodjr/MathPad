# MathPad — Infrastructure & Configuration Reference

Operational reference for MathPad's public hosting, custom domain, and Google
Drive OAuth.

> **No secrets here.** The OAuth client ID is public by design (it ships in
> `docs/js/drive.js` and is sent to every browser). The app uses Google Identity
> Services (GIS) implicit/token flow, which has **no client secret**. DNS and
> verification records below are all public. Nothing in this file is sensitive.

Last reviewed: 2026-06-27

---

## At a glance

| Thing | Value |
|---|---|
| Public app URL | `https://mathpad.hoodoop.com` |
| Hosting | GitHub Pages, repo `wpwoodjr/MathPad`, served from `docs/` on `main` |
| Domain | `hoodoop.com` (registered 2026-06-26, **expires 2036-06-26**) |
| Registrar / DNS host | **Squarespace** (`account.squarespace.com → Domains → hoodoop.com → DNS`) |
| OAuth project owner | `wpwoodjr@gmail.com` (Google Cloud) |
| OAuth client ID | `274176068779-rjoi1liel0smr65d58ji03tjumla8us6.apps.googleusercontent.com` |
| OAuth scope | `https://www.googleapis.com/auth/drive.file` (per-file, **non-sensitive**) |
| Consent screen | **External**, target publishing status **In production** |

Status legend below: ✅ confirmed live · ⬜ to confirm / finish.

---

## 1. Domain & registrar

| Field | Value |
|---|---|
| Domain | `hoodoop.com` |
| Registrar | Squarespace Domains (successor to Google Domains) |
| Registered | 2026-06-26 |
| Expires | 2036-06-26 (10-year term) |
| Auto-renew | ⬜ confirm **ON** in Squarespace |
| Nameservers | `NSE1.SQUARESPACEDNS.COM` … `NSE4.SQUARESPACEDNS.COM` |
| Registry status | `clientDeleteProhibited`, `clientTransferProhibited` |

DNS is hosted by Squarespace (the nameservers above). All records in §2 are
managed there.

---

## 2. DNS records (Squarespace)

Managed at: `account.squarespace.com → Domains → hoodoop.com → DNS Settings → Custom records`.

In Squarespace's "Add Record" form, **NAME** is just the label (e.g. `mathpad`
or `@` for the root) — Squarespace appends `.hoodoop.com` automatically.

| Purpose | Type | Name | Value | Status |
|---|---|---|---|---|
| MathPad site → GitHub Pages | CNAME | `mathpad` | `wpwoodjr.github.io` | ✅ live |
| GitHub domain verification | TXT | `_github-pages-challenge-wpwoodjr` | `38557927a0352c1fffd202b3435e25` | ✅ |
| Google Search Console verify | TXT | `@` | `google-site-verification=7GJ6Xs2HyRZm-_rMGN-AibMMtYdJgt39zqVBcir9aJY` | ✅ |


**Resolution check (expected):**
`mathpad.hoodoop.com` → CNAME `wpwoodjr.github.io.` → GitHub Pages anycast IPs
`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.

---

## 3. GitHub Pages hosting

| Field | Value |
|---|---|
| Repo | `github.com/wpwoodjr/MathPad` |
| Publishing source | `main` branch, `/docs` folder |
| Custom domain | `mathpad.hoodoop.com` (stored in `docs/CNAME`) — ✅ set |
| HTTPS cert | Let's Encrypt, auto-provisioned & auto-renewed by GitHub — ✅ live |
| Enforce HTTPS | ✅ tick in **Settings → Pages** once it un-greys (adds HTTP→HTTPS redirect) |
| GitHub domain verification | ✅ **Account → Settings → Pages → Verified domains** (anti-takeover; see §2 TXT) |

**Related repo files**
- `docs/CNAME` — contains `mathpad.hoodoop.com` (binds the custom domain to this repo)
- `docs/privacy.html`, `docs/terms.html` — privacy / terms pages used by the OAuth consent screen (§5)

**URL behavior**
- `https://mathpad.hoodoop.com/` → MathPad (primary)
- `https://wpwoodjr.github.io/MathPad/` → 301 redirect to the custom domain (kept as fallback)

---

## 4. Google Search Console (domain verification)

Purpose: verify ownership of `hoodoop.com` so it can be used as an OAuth
**Authorized domain** (§5). **Must be verified by `wpwoodjr@gmail.com`** — the
same account that owns the OAuth project — or the consent screen won't accept it.

| Field | Value |
|---|---|
| Property type | **Domain** property: `hoodoop.com` |
| Verifying account | `wpwoodjr@gmail.com` |
| Method | DNS TXT at root (`@`) — see §2 |
| Status | ✅ verified |

---

## 5. Google OAuth — Drive integration

Google Cloud project owned by `wpwoodjr@gmail.com`. Console:
`console.cloud.google.com` (OAuth settings now under **Google Auth Platform** —
tabs Branding / Audience / Data access / Clients).

### Client (Auth Platform → Clients / APIs & Services → Credentials)
| Field | Value |
|---|---|
| Type | Web application (OAuth 2.0 Client ID) |
| Client ID | `274176068779-rjoi1liel0smr65d58ji03tjumla8us6.apps.googleusercontent.com` |
| Used in code | `docs/js/drive.js` (`DRIVE_CLIENT_ID`, ~line 11) |
| Client secret | none (GIS implicit/token flow) |
| Authorized JavaScript origins | `https://mathpad.hoodoop.com` ✅ · `https://wpwoodjr.github.io` (fallback, keep) |
| Authorized redirect URIs | none (token flow doesn't use them) |

### Consent screen — Branding (Auth Platform → Branding)
| Field | Value |
|---|---|
| App home page | `https://mathpad.hoodoop.com` |
| Privacy policy | `https://mathpad.hoodoop.com/privacy.html` |
| Terms of service | `https://mathpad.hoodoop.com/terms.html` |
| Authorized domains | `hoodoop.com` |

### Consent screen — Audience (Auth Platform → Audience)
| Field | Value |
|---|---|
| User type | **External** (any Google account) |
| Publishing status | target **In production** (lifts the 100-test-user cap) ✅ |

### Scopes / verification
- Only scope requested: `https://www.googleapis.com/auth/drive.file` (per-file
  access — the app sees only files it creates or the user explicitly opens).
- This scope is **non-sensitive**, so going to production does **not** require
  the restricted-scope security assessment (CASA), and typically no formal
  verification review — follow whatever the console prompts.

### Auth runtime notes
- Auth via Google Identity Services (GIS) implicit flow; access tokens last ~1h
  with **no** refresh token. Renewal is gesture-coupled (`maybeRenewToken` on
  pointerdown/keydown). See `docs/js/drive.js` and the "Google Drive Integration"
  section of `CLAUDE.md`.
- Canonical data file: `MathPad.json` in a "MathPad" folder on each user's Drive.

---

## 6. Renewal / expiry calendar

| Item | Cadence | Action |
|---|---|---|
| `hoodoop.com` registration | expires **2036-06-26** | keep **auto-renew ON** at Squarespace |
| HTTPS certificate | ~90 days | automatic (GitHub / Let's Encrypt) — no action |
| GIS access token (runtime) | ~1 hour | automatic gesture-coupled renewal in app |
| OAuth app verification | n/a for non-sensitive scope | none expected; re-check if Google flags branding |

---

## 7. Failure modes & recovery

- **`mathpad.hoodoop.com` stops resolving** (domain lapses / DNS removed):
  GitHub still hosts the files. Fall back by removing the custom domain
  (delete `docs/CNAME` or clear it in Settings → Pages) → site serves again at
  `https://wpwoodjr.github.io/MathPad/`. Ensure `https://wpwoodjr.github.io`
  stays in the OAuth origins so Drive sign-in keeps working.
- **Drive sign-in fails after a URL change:** check the **Authorized JavaScript
  origins** include wherever the app is actually served.
- **OAuth "unverified app" warning / user cap returns:** confirm consent screen
  is **In production** and the `hoodoop.com` authorized domain + privacy/ToS
  URLs still resolve.
- **User data is never tied to the domain:** it lives in each user's
  `localStorage` and their own Google Drive (`MathPad.json`). A domain outage
  never loses user data.
- **Subdomain-takeover hygiene:** if you ever stop using the domain, remove the
  `mathpad` CNAME **and** `docs/CNAME` together — don't leave a DNS record
  pointing at github.io with no repo claiming it.

---

## 8. Setup checklist (one-time)

- [x] Register `hoodoop.com` (Squarespace, 10-yr)
- [x] DNS `mathpad` CNAME → `wpwoodjr.github.io`
- [x] GitHub Pages custom domain `mathpad.hoodoop.com` (`docs/CNAME`)
- [x] HTTPS cert provisioned
- [x] Enforce HTTPS toggled on
- [x] GitHub domain verification TXT (`_github-pages-challenge-wpwoodjr`)
- [x] Search Console Domain property `hoodoop.com` verified (as `wpwoodjr@gmail.com`)
- [x] OAuth origin `https://mathpad.hoodoop.com` added
- [x] Consent screen branding (home / privacy / terms / authorized domain)
- [x] Consent screen published → In production
- [ ] Squarespace auto-renew confirmed ON
- [x] End-to-end test: load site, sign into Drive, sync, no warning
