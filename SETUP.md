# Setting up Aperitif Flow

This guide takes you from this repository to a running Aperitif Flow at your own web address, on your own accounts. Allow about an
hour. You do it once; after that, updates are a `git pull`, a migration command and a deploy (section 10).

What you end up with:

- **Vercel** runs the website (Next.js), in Sydney.
- **Neon** holds the database (Postgres), also in Sydney, created from inside Vercel.
- **Google** signs people in. Only addresses or domains you allow can get in.

Never paste a password, key or connection string into a chat, an email, a ticket or a file you commit. Copy them straight from one
dashboard into another, or keep them in your terminal session only.

## 0. What you need

| Thing | Why | Notes |
|---|---|---|
| A GitHub account with access to this repository | Vercel deploys from it | Ask Transpera to transfer the repository to your GitHub organisation, or to add you |
| A Vercel account | Hosts the app | **Hobby (free) is not allowed for commercial use**: use **Pro** for real work |
| A Google Cloud account | Google sign-in | Free. If your company uses Google Workspace, use an admin account of it |
| A computer with **Node.js 22 or later**, **git** and **psql** | To apply the database migrations (sections 3 and 4) | macOS: `brew install node git libpq` and add libpq's `bin` to your PATH. Windows: use WSL |

Then, once, on that computer:

```bash
corepack enable
git clone https://github.com/<your-org>/Aperitif-Flow.git
cd Aperitif-Flow
pnpm install
```

`corepack enable` gives you the right version of pnpm (the one named in `package.json`).

## 1. Create the Vercel project

1. Go to https://vercel.com/new, pick your team and **Import** the `Aperitif-Flow` repository. If it isn't listed, choose **Adjust GitHub
   App Permissions** and give Vercel access to it.
2. **Project Name:** `aperitif-flow`. **Root Directory → Edit → `apps/web`**. Framework: Next.js (detected).
3. Don't add any variables yet. Press **Deploy**. This first build will fail or show an error page because nothing is configured.
   That's expected.
4. **Settings → Git → Production Branch:** `main`.
5. **Settings → General → Node.js Version:** `24.x`.
6. The region (Sydney, `syd1`) is set by `apps/web/vercel.json`. There's nothing to click. If you want another region, change that
   file **and** pick the same region for the database in the next step.

Your address for now is `https://aperitif-flow.vercel.app` (Vercel shows the exact one under **Settings → Domains**). Section 9 adds
your own domain. Below, **`<APP_URL>`** means that address, with `https://` and no slash at the end.

## 2. Create the database

1. In the Vercel project: **Storage → Create Database → Neon (Serverless Postgres) → Continue**.
2. **Region:** Sydney (`aws-ap-southeast-2`). **Plan:** Free to start. **Name:** `aperitif-flow-db`. Turn **Neon Auth off** and
   **Realtime off**. Create.
3. **Connect project:** tick **Production** and **Preview**. Set **Custom prefix** to `DATABASE`, so the variable is called
   `DATABASE_URL`. Neon adds several other `DATABASE_*` variables; the app only reads `DATABASE_URL`, and the rest do no harm.
4. If it offers a separate database branch for each preview deployment, leave that **off**.

## 3. Apply the migrations

Migrations build the tables, rules and functions the app needs. You run them from your computer.

1. Get the **owner** connection string: in Vercel, **Storage → aperitif-flow-db → Open in Neon**. In Neon, choose **Connect**.
   Pick role `neondb_owner` and database `neondb`, and turn **Connection pooling off**. Copy the string.
2. In your terminal, inside the repository (the leading space keeps it out of your shell history in most shells):

   ```bash
    export DATABASE_URL='paste-the-owner-string-here'
   ```

3. See what will run, then run it:

   ```bash
   pnpm --filter @transpera-flow/db migrate --dry-run
   pnpm --filter @transpera-flow/db migrate
   ```

   The first run applies about 110 migrations. Running it again prints `Nothing to apply`. That is how you know it worked.

If port 5432 is blocked on your network, add `--driver neon-ws` to both commands to go through Neon's WebSocket route instead.

## 4. Create the app's database login

The owner login can see everything. The app's day-to-day queries run as a weaker login, `authenticator`, so the database's own
row-level security decides what each person sees.

In the same terminal:

```bash
export APP_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v app_password="$APP_PASSWORD" -f packages/db/scripts/create-app-login.sql
```

Now build **`APP_DATABASE_URL`**. Take the **pooled** connection string from Neon (**Connect**, with **Connection pooling on**; its
host contains `-pooler`). Replace `neondb_owner` with `authenticator`, and the password after the colon with your `APP_PASSWORD`.
It looks like:

```
postgresql://authenticator:<APP_PASSWORD>@ep-xxxx-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require
```

You'll paste it into Vercel in section 6. You can run the `psql` command again at any time: it sets a new password, which you then
put into `APP_DATABASE_URL` again.

When you're done, close the terminal (or `unset DATABASE_URL APP_PASSWORD`) so the strings don't linger.

## 5. Google sign-in

1. Go to https://console.cloud.google.com. Create a project called `aperitif-flow`, or pick an existing one.
2. **APIs & Services → OAuth consent screen** (on newer consoles, **Google Auth Platform → Branding**):
   - **App name:** Aperitif Flow. **Support email:** yours.
   - **Logo:** `apps/web/src/app/apple-icon.png` from this repository.
   - **Audience:** **Internal** if everyone signing in is in your Google Workspace. Otherwise **External**, then **Publish app** so
     it is **In production**.
   - **Scopes:** only `openid`, `email` and `profile`.
3. **Credentials → Create credentials → OAuth client ID → Web application**, named `Aperitif Flow`:
   - **Authorised JavaScript origins:** `<APP_URL>`
   - **Authorised redirect URIs:** `<APP_URL>/api/auth/callback/google`
4. Create it. Keep the page open: you'll copy the **Client ID** and **Client secret** into Vercel next.

Changes in Google can take a few minutes to take effect.

## 6. Environment variables

In Vercel: **Settings → Environment Variables**. For each row, tick **Production** and **Preview**, unless the table says otherwise.
Mark the ones in the "Sensitive" column as **Sensitive**: Vercel never shows them again.

| Name | Value | Sensitive |
|---|---|---|
| `DATABASE_URL` | Added by Neon in section 2. Check it's there | (already) |
| `APP_DATABASE_URL` | The `authenticator` string from section 4 | Yes |
| `BETTER_AUTH_SECRET` | The output of `openssl rand -base64 48` | Yes |
| `OAUTH_PROXY_SECRET` | Another `openssl rand -base64 48` (a different one) | Yes |
| `BETTER_AUTH_URL` | `<APP_URL>`. **Production only** | No |
| `AUTH_PROVIDERS` | `google` | No |
| `ACCESS_ADMIN_EMAILS` | Your own Google address, or several separated by commas. These people always get in, as **Owner** | No |
| `GOOGLE_CLIENT_ID` | From section 5 | No |
| `GOOGLE_CLIENT_SECRET` | From section 5 | Yes |

Leave `ALLOW_MULTIPLE_WORKSPACES` unset. This deployment holds one workspace, your company
([ADR 0024](docs/adr/0024-one-workspace-per-deployment.md)).

The app refuses to start in Production or Preview without a separate `APP_DATABASE_URL`, and the sign-in pages show a 404 without
`DATABASE_URL` and `BETTER_AUTH_SECRET`. If you see either, a variable is missing.

Then deploy with the new settings: **Deployments → the latest one → ⋯ → Redeploy**.

## 7. First sign-in

1. Open `<APP_URL>` and sign in with Google, using an address in `ACCESS_ADMIN_EMAILS`.
2. You'll see **New workspace**. Create your company's workspace, for example name `Aperitif`, address `aperitif`. From then on everyone
   who signs in goes straight into it.
3. **Settings → Access → Who can sign in.** Add your team:
   - **A domain** (for example `aperitif.com.au`): anyone with a verified Google address on it gets that domain's role.
   - **Named emails**: a specific person and role. This overrides their domain's role. Use it for contractors.
   - **Roles:**
     - **Owner** can do everything.
     - **Agency admin** edits everything, sees individual pay and manages this list (except Owners).
     - **Viewer** reads everything except individual pay, and edits nothing.
   - Anyone not matched is refused.
4. Check it works: create or upload a process, run a simulation and reload the page. It's still there. Then try an address that isn't
   on the list: it should be refused.

## 8. Starting data (optional, once)

A new workspace's **Set up** pages are empty. To start from sensible defaults instead, run this once from your computer, with
`DATABASE_URL` set as in section 3:

```bash
pnpm --filter @transpera-flow/db capacity:starter --workspace aperitif
```

It adds:

- two departments;
- tiers T1 to T3, with example numbers marked **estimate**;
- nine roles.

It adds no people and no clients; you key those in. It refuses to touch a workspace that already has data in it.

Don't run `capacity:example`: that loads a made-up agency for testing.

## 9. Your own domain (optional)

1. Vercel: **Settings → Domains → Add**, for example `flow.aperitif.com.au`, and add the DNS record Vercel shows at your domain provider.
2. When it says **Valid**, update everything that names the address. The new address is the new `<APP_URL>`:
   - `BETTER_AUTH_URL` in Vercel (Production).
   - In Google, add the new origin and redirect URI from section 5. Keep the old ones until the switch is done.
3. Redeploy.

## 10. Updating to a new version

When Transpera sends a new version, or you change the code:

1. `git pull`, then `pnpm install`.
2. **Migrations first:** with `DATABASE_URL` set as in section 3, run `pnpm --filter @transpera-flow/db migrate --dry-run`, then
   `pnpm --filter @transpera-flow/db migrate`.
3. Push to `main`, or merge the pull request. Vercel deploys it.

Preview deployments (one for every branch or pull request) use the same database as production, so don't test destructive changes
on a preview.

## 11. Backups

- **In the app:** on the Overview, **Export → JSON backup** saves the whole workspace as one file. Do this before big changes
  and keep the files somewhere safe.
- **Neon** can restore the database to an earlier point in time. How far back depends on your Neon plan: see
  https://neon.com/docs/introduction/plans.

## 12. Costs

- **Vercel:** Pro is required for commercial use (https://vercel.com/docs/limits/fair-use-guidelines).
- **Neon Free:** 0.5 GB of storage and 100 compute-hours a month. The database sleeps after 5 minutes idle, so the first request after
  a quiet spell takes a second or two longer. Move to a paid Neon plan from the Neon console if you outgrow it.
- **Google sign-in:** free.

## 13. Optional extras

- **Error reports (Sentry):** create a Next.js project at https://sentry.io and set `NEXT_PUBLIC_SENTRY_DSN` in Vercel. For readable
  stack traces, also set `SENTRY_AUTH_TOKEN` (Sensitive), `SENTRY_ORG` and `SENTRY_PROJECT`. Redeploy, then sign in as an Owner and open
  `<APP_URL>/monitoring-check` to send a test error. Nothing is sent to Sentry without the DSN.
- **Microsoft sign-in:**
  1. In your Microsoft Entra admin centre, register an app for **this organisational directory only**. Use redirect URI
     `<APP_URL>/api/auth/callback/microsoft`.
  2. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (Sensitive) and `MICROSOFT_TENANT_ID` (your tenant ID, never `common`).
  3. Set `AUTH_PROVIDERS` to `google,microsoft` (or just `microsoft`), then redeploy.
- **Claude or ChatGPT (MCP):** each person makes a token from the menu under their name (bottom left) → **API tokens**, and follows the steps on that page.
  The connection is read-only.

## When something goes wrong

| What you see | Usually |
|---|---|
| The home or sign-in page shows 404 | `DATABASE_URL` or `BETTER_AUTH_SECRET` is missing, or you didn't redeploy after adding them |
| The deployment fails to start, or every page errors after setup | `APP_DATABASE_URL` is missing or wrong (wrong password, or the owner string instead of `authenticator`) |
| Google says `redirect_uri_mismatch` | The redirect URI in Google doesn't exactly match `<APP_URL>/api/auth/callback/google`, or `BETTER_AUTH_URL` is different from the address you opened |
| "You don't have access" after signing in | Your address isn't in `ACCESS_ADMIN_EMAILS` or on the Access list |
| A page complains about the database after an update | Run the migrations (section 10, step 2) |

The code is documented in [`README.md`](README.md) and [`docs/`](docs/). The design decisions are recorded in [`docs/adr/`](docs/adr/).
