<div align="center">
  <h1>Warden</h1>
  <p><em>A Bitwarden-compatible password server for Cloudflare Workers, with a mobile-optimized Web Vault.</em></p>

  <img alt="Platform" src="https://img.shields.io/badge/platform-Cloudflare%20Workers-f59e0b?logo=cloudflare&logoColor=white">
  <img alt="Backend" src="https://img.shields.io/badge/backend-Rust%20%2B%20D1-dea584?logo=rust&logoColor=white">
  <img alt="Web Vault" src="https://img.shields.io/badge/web%20vault-v2026.8.9-2563eb">
  <img alt="License" src="https://img.shields.io/badge/license-MIT%20%2B%20GPL--3.0-22c55e">

  <a href="https://github.com/shiranzby/warden-worker/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/shiranzby/warden-worker?color=ED8936&logo=github"></a>
  <a href="https://github.com/shiranzby/warden-worker/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/shiranzby/warden-worker"></a>
</div>

---

- **English** | [简体中文](./README.md)
- [Deployment & Migration Guide](./docs/交付文档.md) (Chinese)
- [AI Deployment Manual](./AI_Skill.md)
- [Web Vault Source Repository](https://github.com/shiranzby/vw_web_builds)
- [LICENSE](./LICENSE)

## Disclaimer

Warden is a self-hosted password server implementing the Bitwarden server protocol, running on
Cloudflare Workers. It is derived from the open-source project
[warden](https://github.com/qaz741wsd856/warden-worker); its frontend is built from
[Bitwarden clients](https://github.com/bitwarden/clients).

- This project is **not affiliated with Bitwarden Inc.** "Bitwarden" is a registered trademark of
  Bitwarden Inc. This project is protocol-compatible only, and must not use Bitwarden's marks or
  logos for promotion.
- This project does not collect, transmit, or store any user data. All data resides in the
  operator's own Cloudflare account.
- This software is provided "as is", without warranty of any kind, express or implied. Evaluate it
  yourself and comply with the laws and regulations applicable to you.
- Recommended for personal or small-scale self-hosting. Production use should be preceded by your
  own security assessment and backup rehearsal.

## Features

**Server**

- Full CRUD for vault items, folders, favorites and trash
- Bitwarden Send: share encrypted text or files via a link
- TOTP: store and generate time-based one-time passwords
- Attachments: backed by Cloudflare KV or R2
- Device management: inspect and revoke active sessions
- Live sync and push notifications: WebSocket and mobile push
- Built-in rate limiting: 5 login attempts / 60 s, 15 Send access attempts / 60 s
- Compatible with official Bitwarden clients (mobile apps, browser extensions, web app)

**Web Vault (customizations in this project)**

- Bottom tab bar for one-handed navigation on mobile
- Consistent forms: single-line inputs are 38 px tall with a 40 px visible box, content vertically centered
- Dropdown panels open flush against the field, avoid the soft keyboard, and expand on pointer release
- Send page: redundant header removed, extra options collapsible, Save and Cancel split one row in-page
- Dark theme follows the in-app setting, covering the tab bar, account card, authenticator page and TOTP badge

## Architecture

| Layer | Component | Responsibility |
|---|---|---|
| L1 Backend | Cloudflare Worker (Rust → WASM) | Serves `/api/*`, `/identity/*`, `/notifications/*` |
| L2 Data | D1, KV or R2, Durable Objects, Rate Limiting | Primary data, attachments, push notifications, throttling |
| L3 Frontend | Web Vault (built from a source fork) | Static assets, published alongside the Worker |

The frontend source lives in a separate repository and is built into
`bw_web_vault-<version>.tar.gz` (≈36 MB), which the deployment process unpacks into
`public/web-vault/` and publishes together with the Worker.

## Getting Started

### Prerequisites

- A Cloudflare account
- A GitHub account (to fork this repository and run Actions)
- No local tooling required (`wrangler` is optional, for CLI deployment)

### Option 1: Deploy with an AI assistant

Provide this repository together with [AI_Skill.md](./AI_Skill.md) to a coding-capable AI assistant.
That document defines the full deployment procedure; the assistant will ask for the required
Cloudflare account details and credentials, then create resources, write Secrets, run the build and
deploy, and verify the result.

### Option 2: Fork and run the workflows (recommended)

The build workflow fetches the frontend source from the public
[`shiranzby/vw_web_builds`](https://github.com/shiranzby/vw_web_builds) repository, so
**you do not need to fork the frontend repository** to build the same customized frontend.

1. Fork this repository.
2. Create a D1 database and a KV namespace in Cloudflare (suggested names: `vault1`, `warden-attachments`).
3. Add the following Secrets under `Settings → Secrets and variables → Actions`:

   | Secret | Required | Description |
   |---|:--:|---|
   | `CLOUDFLARE_EMAIL` | Yes | Cloudflare account email |
   | `CLOUDFLARE_API_KEY` | Yes | Global API Key (not a Bearer token) |
   | `CLOUDFLARE_ACCOUNT_ID` | Yes | Cloudflare account ID |
   | `D1_DATABASE_ID` | Yes | D1 database ID |
   | `ALLOWED_EMAILS` | Yes | Comma-separated list of emails allowed to register; empty means unrestricted |
   | `JWT_SECRET` | Yes | Access token secret, a random string |
   | `JWT_REFRESH_SECRET` | Yes | Refresh token secret, a random string |
   | `R2_NAME` | No | Required only if attachments are stored in R2 |

4. Run `Actions → Build Web Vault (patched) → Run workflow` with `version` set to `v2026.8.9` and wait (≈5 min).
5. Run `Actions → Build → Run workflow` and wait (≈4 min).
6. Open the deployed domain and register an account.

> The deployment workflow looks up the artifact named `bw_web_vault-<version>`, so the build must
> complete before the deployment is triggered.

### Option 3: Wrangler CLI

```bash
npm install -g wrangler
wrangler login

# Download and unpack the frontend from the bw_web_vault-v2026.8.9 Actions artifact
tar -xzf bw_web_vault.tar.gz
mv web-vault public/web-vault

wrangler d1 migrations apply vault1 --remote
wrangler deploy
```

### Custom domain

1. Add a DNS `A` record pointing to `192.0.2.1` with the proxy enabled (orange cloud).
2. Add a Workers route `<your-domain>/*` targeting the `warden-worker` Worker.

Without a custom domain, enable `workers_dev = true` in `wrangler.toml` (disabled by default,
since `*.workers.dev` domains are prone to error 1101).

## Configuration

Configuration lives in `wrangler.toml`.

| Variable | Default | Description |
|---|---|---|
| `DISABLE_USER_REGISTRATION` | `"false"` | Set to `"true"` to hide the registration entry point |
| `BASE_URL` | Inferred | Site URL used when generating upload/download links |

Database, KV/R2, Durable Objects and rate-limiting bindings are defined in the same file and require
a redeploy when changed. Schema changes are managed by `migrations/` and applied automatically
during deployment.

## Security

- Vault items are encrypted client-side with a key derived from your **master password**. The server
  stores ciphertext only and cannot read plaintext. Changing the domain or migrating the database
  does not affect decryption; **a lost master password cannot be recovered.**
- Secrets must be stored in GitHub Secrets only, never committed to the repository.
- A `backup-d1.yaml` workflow is provided for scheduled database backups. Rehearse restores regularly.

## FAQ

**Why isn't the frontend source in this repository?**
It comes from the Bitwarden clients monorepo, which is about 1.2 GB, and is kept separately in
[`shiranzby/vw_web_builds`](https://github.com/shiranzby/vw_web_builds). The build artifact
(≈36 MB) is likewise not version-controlled, so a new environment requires one build run.

**`/custom.js` and `/custom.css` return 404 — are files missing?**
This is expected. Earlier versions injected those two files after deployment to customize the UI.
That approach has been removed; a 404 confirms the runtime injection layer no longer exists.

**Some advanced Web Vault features do not work.**
The Web Vault UI is built from upstream Bitwarden/Vaultwarden sources, which expose entry points for
features this server does not implement.

**Does deploying cost anything?**
It runs at no cost within the Cloudflare Workers, D1 and KV free tiers. Monitor usage under heavier load.

## Contributing

Issues and pull requests are welcome.

- Backend changes: run `cargo fmt` and `cargo clippy --target wasm32-unknown-unknown --no-deps` first.
- Frontend changes: run the artifact assertion script and add assertions for any new batch.
- Commits touching workflow files must carry `[skip ci]`.
- Never commit accounts, keys, or other credentials to any file in the repository.

## License

This project consists of two parts under different licenses:

| Part | License | File |
|---|---|---|
| Server (`src/`, `migrations/`, …) | MIT | [LICENSE](./LICENSE) (© 2025 Deep Gaurav) |
| Frontend (derived from Bitwarden clients) | GPL-3.0 | `.vwsrc/LICENSE_GPL.txt` |

## Acknowledgements

- [warden](https://github.com/qaz741wsd856/warden-worker) — the upstream server this project derives from
- [Vaultwarden](https://github.com/dani-garcia/vaultwarden), [bw_web_builds](https://github.com/dani-garcia/bw_web_builds)
- [Bitwarden clients](https://github.com/bitwarden/clients) — source of the Web Vault
- Cloudflare Workers, D1, KV
