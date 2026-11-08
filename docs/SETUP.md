# Shop Platform: setup guide

A monorepo with a TanStack Start frontend/BFF in front of three backend systems. Login is Swedish BankID, brokered through Keycloak (OIDC).

```
Browser
  └─ TanStack Start (UI + BFF, :3000)
        ├─ Keycloak (OIDC, :8080) ── BankID broker (Signicat / Criipto / Nets)
        ├─ Medusa  (cart & orders,      REST, :9000)  → PostgreSQL
        ├─ Strapi  (content & SEO,      REST, :1337)  → PostgreSQL
        └─ Frappe  (rules & prices,     REST, :8000)  → MariaDB + Redis
```

**Rules of the architecture**

- The BFF talks to Medusa, Strapi and Frappe **only through their REST APIs**. It never connects to their databases.
- PostgreSQL is used by Medusa, Strapi and Keycloak. MariaDB is used only by Frappe (Frappe also needs Redis).
- Only the BFF and Keycloak are meant to be reachable from the internet. Everything else stays on an internal network.

## 1. Prerequisites

- **Node.js 22 LTS** and **pnpm** (`npm i -g pnpm`)
- **Git**
- **Docker Desktop** with the WSL2 backend (Frappe's `bench` does not run natively on Windows)
- **JetBrains WebStorm**

**Strong recommendation (Windows):** keep the project inside the WSL filesystem, for example `\\wsl$\Ubuntu\home\<you>\shop-platform`. File watching and Docker bind mounts are much faster than on `C:\`, and Frappe's file permissions behave. WebStorm can open that path directly, and the terminal (Alt+F12) can be set to a WSL shell in **Settings → Tools → Terminal**.

## 2. Final folder structure

```
shop-platform/
├── apps/
│   ├── web/                      # TanStack Start (UI + BFF)
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── __root.tsx
│   │       │   ├── index.tsx
│   │       │   ├── produkter/    # index.tsx (catalog), $slug.tsx (product page)
│   │       │   ├── kundportal/   # route.tsx (protected layout), ordrar.tsx, profil.tsx
│   │       │   └── auth/         # login.ts, callback.ts, logout.ts
│   │       ├── server/           # BFF layer (server only)
│   │       │   ├── auth/         # oidc.ts, session.ts, guards.ts
│   │       │   ├── clients/      # medusa.ts, strapi.ts, frappe.ts
│   │       │   ├── services/     # catalog / pricing / cart / portal services
│   │       │   ├── functions/    # createServerFn functions called by the UI
│   │       │   └── env.ts        # validated env vars (zod)
│   │       ├── components/
│   │       └── lib/
│   ├── medusa/                   # cart & orders
│   ├── strapi/                   # content & SEO
│   └── frappe/                   # Docker dev container workspace
│       └── frappe-bench/
│           └── apps/shop_rules/  # your custom Frappe app (the only part in git)
├── packages/
│   └── shared-types/
├── infra/
│   ├── docker-compose.yml
│   ├── postgres/init.sql
│   └── keycloak/realm-export.json
├── .env.example
├── .gitignore
├── pnpm-workspace.yaml
└── package.json
```

## 3. Create the root and skeleton

```bash
mkdir shop-platform && cd shop-platform
git init
mkdir -p apps/frappe packages/shared-types/src infra/postgres infra/keycloak
touch pnpm-workspace.yaml .env.example .gitignore infra/docker-compose.yml infra/postgres/init.sql
```

In WebStorm: **File → Open** the `shop-platform` folder.

**`pnpm-workspace.yaml`**: only `web` and the shared packages are in the workspace. Medusa and Strapi are standalone projects, because their CLIs create their own `package.json` and lockfile, which can clash with a pnpm workspace.

```yaml
packages:
  - apps/web
  - packages/*
```

**`.gitignore`**

```gitignore
node_modules
.env
.DS_Store
dist
.output

# Frappe bench: version only your custom app
apps/frappe/frappe-bench/*
!apps/frappe/frappe-bench/apps/
apps/frappe/frappe-bench/apps/*
!apps/frappe/frappe-bench/apps/shop_rules/
```

**Root `.env`** (read by Docker Compose; never commit it). Copy `.env.example` and fill in:

```env
SHOP_WEB_CLIENT_SECRET=change-me
BANKID_CLIENT_ID=
BANKID_CLIENT_SECRET=
BANKID_ISSUER=
BANKID_AUTH_URL=
BANKID_TOKEN_URL=
BANKID_USERINFO_URL=
BANKID_JWKS_URL=
BANKID_SCOPES=openid profile
BANKID_SSN_CLAIM=ssn
```

## 4. Infrastructure (Docker Compose)

**`infra/docker-compose.yml`**

> `name:` must start at the very first column, above `services:`. If it is indented, Compose fails with `services.name must be a mapping`. The line is optional and can be deleted.

```yaml
name: shop-platform

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports: ["127.0.0.1:5432:5432"]
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

  mariadb:
    image: mariadb:10.6
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --skip-character-set-client-handshake
      - --skip-innodb-read-only-compressed
    environment:
      MYSQL_ROOT_PASSWORD: root
    ports: ["127.0.0.1:3306:3306"]
    volumes:
      - maria_data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    ports: ["127.0.0.1:6379:6379"]

  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev --import-realm
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
      KC_DB_USERNAME: app
      KC_DB_PASSWORD: app
      # Placeholders used by infra/keycloak/realm-export.json
      SHOP_WEB_CLIENT_SECRET: ${SHOP_WEB_CLIENT_SECRET:-dev-secret-change-me}
      BANKID_CLIENT_ID: ${BANKID_CLIENT_ID:-placeholder}
      BANKID_CLIENT_SECRET: ${BANKID_CLIENT_SECRET:-placeholder}
      BANKID_ISSUER: ${BANKID_ISSUER:-https://broker.example.invalid}
      BANKID_AUTH_URL: ${BANKID_AUTH_URL:-https://broker.example.invalid/authorize}
      BANKID_TOKEN_URL: ${BANKID_TOKEN_URL:-https://broker.example.invalid/token}
      BANKID_USERINFO_URL: ${BANKID_USERINFO_URL:-https://broker.example.invalid/userinfo}
      BANKID_JWKS_URL: ${BANKID_JWKS_URL:-https://broker.example.invalid/jwks}
      BANKID_SCOPES: ${BANKID_SCOPES:-openid profile}
      BANKID_SSN_CLAIM: ${BANKID_SSN_CLAIM:-ssn}
    depends_on: [postgres]
    ports: ["8080:8080"]
    volumes:
      - ./keycloak:/opt/keycloak/data/import:ro

  # Dev container for Frappe/bench (not a production setup)
  frappe:
    image: frappe/bench:latest
    command: sleep infinity
    working_dir: /workspace
    depends_on: [mariadb, redis]
    ports: ["8000:8000"]
    volumes:
      - ../apps/frappe:/workspace

volumes:
  pg_data:
  maria_data:
```

Frappe's realtime service (socketio) defaults to port 9000, which clashes with Medusa. The compose file does not expose it.

**`infra/postgres/init.sql`**

```sql
CREATE DATABASE medusa;
CREATE DATABASE strapi;
CREATE DATABASE keycloak;
```

This only runs the first time, on an empty `pg_data` volume. After changing it, run `docker compose ... down -v` to reset.

**Keycloak realm:** copy `realm-export.json` to `infra/keycloak/realm-export.json`. It defines the `shop` realm, the `shop-web` client (Authorization Code + PKCE), the `bankid` identity provider and the personal-number mappers.

**Start the infrastructure**

```bash
docker compose --env-file .env -f infra/docker-compose.yml config   # validate first
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres mariadb redis keycloak
```

Always pass `--env-file .env`. Compose otherwise looks for `.env` next to the compose file (`infra/`), not in the repo root, and the Keycloak variables silently fall back to their defaults.

## 5. Medusa (PostgreSQL, REST API)

```bash
cd apps
npx create-medusa-app@latest medusa --use-npm --db-url "postgres://app:app@localhost:5432/medusa"
```

- Database URL: `postgres://app:app@localhost:5432/medusa`
- Answer **no** to the Next.js storefront. TanStack Start is the storefront.
- It runs migrations and creates an admin user.
- Remove a nested git repo if one was created: `rm -rf medusa/.git`

Run it:

```bash
cd medusa && npm run dev      # API :9000, admin :9000/app
```

For the BFF you need a **Publishable API key** (Admin → Settings → Publishable API Keys). It is sent as the `x-publishable-api-key` header on store calls. If the BFF calls admin endpoints, use a secret API key or admin token.

## 6. Strapi (PostgreSQL, REST API)

```bash
cd apps
npx create-strapi@latest strapi
```

Choose TypeScript and PostgreSQL: host `localhost`, port `5432`, database `strapi`, user `app`, password `app`. Run `npx create-strapi@latest --help` to see the non-interactive flags (including `--no-git-init`).

```bash
cd strapi && npm run develop      # :1337
```

1. Create the content types: `product-content` (description, images, SEO component) and `page`.
2. **Settings → API Tokens:** create a read-only token for the BFF.
3. **Settings → Users & Permissions → Public:** keep everything closed, so only the token has access.

## 7. Frappe (MariaDB)

Start the dev container and open a shell in it:

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d frappe
docker compose --env-file .env -f infra/docker-compose.yml exec frappe bash
```

Inside the container (you start in `/workspace`, which is `apps/frappe` on your machine):

```bash
bench init --skip-redis-config-generation --frappe-branch version-15 frappe-bench
cd frappe-bench

# Point bench at the compose services instead of localhost
bench set-config -g db_host mariadb
bench set-config -g redis_cache    redis://redis:6379/0
bench set-config -g redis_queue    redis://redis:6379/1
bench set-config -g redis_socketio redis://redis:6379/2

# Bench must not start its own redis
sed -i '/redis/d' ./Procfile

bench new-site shop.localhost \
  --mariadb-root-password root \
  --admin-password admin \
  --no-mariadb-socket

bench set-config -g default_site shop.localhost
bench --site shop.localhost set-config developer_mode 1

# Your custom app (doctypes: price list, discount rule; api.py; hooks.py)
bench new-app shop_rules
bench --site shop.localhost install-app shop_rules

bench start      # :8000
```

Open http://shop.localhost:8000 and log in as `Administrator` / `admin`.

For the BFF, create a service user, then **User → API Access → Generate Keys**. The BFF calls Frappe with:

```
Authorization: token <api_key>:<api_secret>
```

Your endpoints in `shop_rules/api.py` marked `@frappe.whitelist()` are available at `/api/method/shop_rules.api.<function>`.

## 8. Authentication: BankID through Keycloak

BankID is not an OIDC provider. It has its own REST API with client-certificate authentication, and you need an agreement with a selling bank. The practical route is a **broker** (Signicat, Criipto/Idura or Nets) that exposes BankID as standard OIDC. Keycloak then uses the broker as an external OIDC identity provider.

```
Browser → TanStack Start (BFF) → Keycloak → BankID broker → BankID app
```

1. Create a test account at your chosen broker and an OIDC application there.
2. Set the broker's redirect URI to `http://localhost:8080/realms/shop/broker/bankid/endpoint`.
3. Put the broker's client ID, secret and endpoint URLs in the root `.env` (`BANKID_*`).
4. Check the broker's docs for the correct scope and the claim name for the personal number, and set `BANKID_SCOPES` and `BANKID_SSN_CLAIM`.
5. Re-import the realm (see below), then test with a **test BankID** (demo.bankid.com lets you create one).

**Re-importing the realm:** Keycloak only imports `realm-export.json` if the realm does not exist yet. After editing the file, delete the `shop` realm in the admin console (http://localhost:8080, `admin` / `admin`) and restart Keycloak, or reset everything with `docker compose ... down -v`.

**How the BFF uses it:** `apps/web/src/server/auth/oidc.ts` (Authorization Code + PKCE) adds `kc_idp_hint=bankid` so users skip the Keycloak login page and go straight to BankID. If the broker needs a parameter to choose QR code vs same-device flow, pass it through `extraParams`. If Keycloak does not forward it, add it under the identity provider's **Forward parameters** setting.

**Personal number (personnummer):**

- It is mapped to the Keycloak attribute `personalNumber` and added to the **ID token only** as `personal_number`.
- Use it as the stable key that links the Keycloak user to the Medusa and Frappe customer.
- Treat it as sensitive personal data: never log it, never send it to the browser, and store it only where needed.

## 9. TanStack Start (the BFF)

```bash
cd apps
pnpm create @tanstack/start@latest web
```

The scaffold command changes between versions. If it fails, follow the current TanStack Start docs.

Create the BFF folders:

```bash
cd web/src
mkdir -p server/{auth,clients,services,functions}
touch server/env.ts server/auth/{oidc,session,guards}.ts \
      server/clients/{medusa,strapi,frappe}.ts
```

Copy `oidc.ts` to `apps/web/src/server/auth/oidc.ts`, then add its dependency:

```bash
pnpm --dir apps/web add openid-client zod
```

**`apps/web/.env.example`** (server-only variables; never prefix them with `VITE_`)

```env
SESSION_SECRET=change-me-32-chars-minimum

OIDC_ISSUER=http://localhost:8080/realms/shop
OIDC_CLIENT_ID=shop-web
OIDC_CLIENT_SECRET=<same value as SHOP_WEB_CLIENT_SECRET>
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
OIDC_IDP_HINT=bankid

MEDUSA_URL=http://localhost:9000
MEDUSA_PUBLISHABLE_KEY=pk_...

STRAPI_URL=http://localhost:1337
STRAPI_API_TOKEN=...

FRAPPE_URL=http://shop.localhost:8000
FRAPPE_API_KEY=...
FRAPPE_API_SECRET=...
```

**Example: a REST client in the BFF**

```ts
// apps/web/src/server/clients/strapi.ts
import { env } from '../env'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${env.STRAPI_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
  })
  if (!res.ok) throw new Error(`Strapi ${res.status}: ${path}`)
  return res.json()
}

export const strapi = {
  getProductContent: (slug: string) =>
    get(`/product-contents?filters[slug][$eq]=${encodeURIComponent(slug)}&populate=*`),
}
```

**Example: a server function that combines all three systems**

```ts
// apps/web/src/server/services/catalog.service.ts
export async function getProductPage(slug: string, user: User | null) {
  const [content, product] = await Promise.all([
    strapi.getProductContent(slug),
    medusa.getProductByHandle(slug),
  ])
  const price = await frappe.getPrice({
    sku: product.variants[0].sku,
    customerId: user?.customerId,
  })
  return { content, product, price }
}
```

```ts
// apps/web/src/server/functions/catalog.fn.ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export const fetchProductPage = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const user = await getOptionalUser() // null for anonymous visitors
    return getProductPage(data.slug, user)
  })
```

**Integration notes**

- The backends have their own user models. The BFF uses service accounts/API keys against them and enforces the OIDC user's permissions itself.
- Store the mapping between the Keycloak user (`sub` / personal number), the Medusa customer and the Frappe customer in Medusa or Frappe.
- Prefer webhooks/subscribers for synchronisation (for example Medusa `order.placed` → Frappe) over synchronous chains in the BFF.

## 10. Shared package and root scripts

```bash
cat > packages/shared-types/package.json <<'EOF'
{ "name": "@shop/shared-types", "version": "0.0.0", "private": true, "main": "src/index.ts" }
EOF
echo "export type Money = { amount: number; currency: string }" > packages/shared-types/src/index.ts
```

**Root `package.json`**

```json
{
  "name": "shop-platform",
  "private": true,
  "scripts": {
    "infra:up": "docker compose --env-file .env -f infra/docker-compose.yml up -d postgres mariadb redis keycloak frappe",
    "infra:down": "docker compose --env-file .env -f infra/docker-compose.yml down",
    "dev:web": "pnpm --dir apps/web dev",
    "dev:medusa": "npm --prefix apps/medusa run dev",
    "dev:strapi": "npm --prefix apps/strapi run develop",
    "dev:frappe": "docker compose --env-file .env -f infra/docker-compose.yml exec frappe bash -c 'cd frappe-bench && bench start'"
  }
}
```

Then run `pnpm install` in the repo root.

## 11. WebStorm setup

- **Node and package manager:** Settings → Languages & Frameworks → Node.js → set pnpm. If the project is in WSL, select the WSL Node interpreter.
- **Run configurations:** create one npm configuration per `dev:*` script (Run → Edit Configurations → + → npm). Then combine them in a **Compound** configuration to start everything at once.
- **Docker:** with the Docker plugin you can run the compose file from the gutter icon and see logs and containers under Services.
- **TypeScript:** each app has its own `tsconfig.json`, and WebStorm picks them up automatically.
- **Frappe app:** WebStorm's Python support is limited. For `apps/frappe/frappe-bench/apps/shop_rules` use PyCharm or VS Code.

## 12. Start order and verification

| Step | Command | Check |
|---|---|---|
| 1 | `pnpm infra:up` | `docker ps` shows postgres, mariadb, redis, keycloak, frappe |
| 2 | `pnpm dev:medusa` | http://localhost:9000/health |
| 3 | `pnpm dev:strapi` | http://localhost:1337/admin |
| 4 | `pnpm dev:frappe` | http://shop.localhost:8000 |
| 5 | `pnpm dev:web` | http://localhost:3000, and the login redirect through Keycloak to BankID |

Default ports: TanStack Start 3000, Medusa 9000, Strapi 1337, Frappe 8000, Keycloak 8080, PostgreSQL 5432, MariaDB 3306, Redis 6379.

## 13. Troubleshooting

| Problem | Cause and fix |
|---|---|
| `services.name must be a mapping` | `name:` is indented under `services:` or your Compose is too old. Put `name:` at column 0 or delete it. Run `docker compose version` and update Docker Desktop if it is old. |
| Keycloak uses placeholder BankID values | Compose did not read the root `.env`. Always pass `--env-file .env`. |
| Realm changes have no effect | Keycloak only imports a realm that does not exist. Delete the `shop` realm in the admin console, or run `docker compose ... down -v`. |
| Databases `medusa`/`strapi`/`keycloak` missing | `init.sql` only runs on an empty volume. Run `down -v` and start again. |
| `bench new-site` cannot connect to the database | Check `bench set-config -g db_host mariadb` and that the `mariadb` container is running. |
| Slow file watching, permission errors with Frappe | Move the project into the WSL filesystem instead of `C:\`. |
| Port already in use | Another service uses the port. Change the mapping in the compose file or stop the other process. |

## 14. Production notes

- Only the BFF and Keycloak should be reachable from the internet. Put Medusa, Strapi, Frappe and both databases on an internal network. Compose already binds the databases to `127.0.0.1`.
- Replace `start-dev` Keycloak with a production setup (`start`, HTTPS, a proper hostname) and change all default passwords.
- The Frappe dev container (`sleep infinity` + `bench start`) is for development only. For production use `frappe_docker`'s production images with your app in `apps.json`.
- Use a real BankID agreement through your broker, and keep all secrets in a secret manager instead of `.env` files.
