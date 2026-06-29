# KPI Appraisal Assistant

A local web application for capturing KPI achievements, refining them with
OpenAI, tracking completion, and exporting appraisal-ready Excel workbooks.

## Run locally

1. Copy `.env.example` to `.env`.
2. Add your OpenAI API key to `.env`.
3. Run:

```powershell
cd backend
npm install
npm start
```

4. Open `http://localhost:3000`.

The API key stays on the server and is never sent to the browser. Draft KPI
data is stored in MongoDB. Browser local storage is used only as an offline
recovery cache.

The frontend is managed separately:

```powershell
cd frontend
npm install
npm run dev
```

Run `npm run build` in `frontend` before serving the production app from the
backend.

## Docker

The Docker setup runs the application and MongoDB together:

```powershell
docker compose up --build -d
```

Open `http://localhost:3010`. MongoDB data is retained on the host in
`./data/db`, so stopping or recreating the containers does not erase KPI data.

Useful commands:

```powershell
docker compose logs -f app
docker compose stop
docker compose start
docker compose down
```

Use `docker compose stop` when you only want to stop the app. `docker compose down`
removes containers and the network, but it leaves `./data/db` in place. Delete
`./data/db` only when you intentionally want to erase all KPI data.

## MongoDB

The default local configuration is:

```text
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=kpi_appraisal
```

Start MongoDB before starting the application:

```powershell
mongod --dbpath .\data\db --bind_ip 127.0.0.1 --port 27017
```

The current workspace is stored in the `workspaces` collection. Existing
browser data is migrated automatically when the collection is empty.

Changes are autosaved to MongoDB about 600 milliseconds after the latest edit.
The sidebar shows the current save state.

## Authentication and licensing

The app creates an initial administrator on first startup:

```text
username: admin
password: admin
```

Change that password after first sign-in. New self-registered users are created
as editors; administrators can be managed through the API.

Licensing uses the same signed key pattern as the Weekwise app. Add these values
to `.env`:

```text
JWT_SECRET=replace-with-a-long-random-jwt-secret
LICENSE_PUBLIC_KEY=base64_encoded_public_key_pem_from_licence_generator
```

`LICENSE_PUBLIC_KEY` should be the base64-encoded PEM public key from the
licensing app. Users can sign in even when no active licence exists. In that
state the header warns admins to activate the licence in **Settings** and tells
non-admin users to contact the system admin. Workspace viewing remains
available, but transactions such as autosave, import/export, AI refinement, and
workspace settings changes require an active licence.

Administrators can use **Settings** to:

- Activate or renew the signed licence key.
- Upload or remove the workspace logo.
- Update workspace display settings.
- Manage user roles and reset user passwords.

Backend code follows a clean-architecture layout under `backend/src`:

- `domain` contains pure KPI rules and normalization.
- `application` contains use cases for config, workspace, refinement, and workbook flows.
- `infrastructure` contains adapters for MongoDB, OpenAI, environment config, and Excel files.
- `interfaces/http` contains the Express app and route wiring.

The legacy-compatible `backend/lib` modules remain for auth, licensing,
settings, and existing imports while the backend continues to move inward.
Frontend source, Vite config, public assets, and build output live under
`frontend`.

## Master KPIs

Use the **Master KPIs** page to maintain annual templates used for new quarters.
You can:

- Create a separate master for each year, such as 2026 or 2027.
- Create, edit, and delete master KPIs manually.
- Upload an unprotected `.xlsx` or `.csv` workbook into the selected year.
- Continue using manual entry when the source workbook is protected.

Editing the master does not modify quarters that already exist. New quarters
copy the master for their matching year with blank achievements, evidence, and
scores. A quarter cannot be created until that year's master has KPIs.

## Corporate proxy

If direct access to `api.openai.com:443` is blocked, set the approved proxy in
`.env`:

```text
OPENAI_PROXY_URL=http://proxy.company.com:8080
```

Authenticated proxies may use a URL such as
`http://username:password@proxy.company.com:8080`. Keep `.env` private. If the
proxy performs TLS inspection, your IT team may also require
`NODE_EXTRA_CA_CERTS` to point to the corporate CA certificate.

## API billing

AI refinement uses the OpenAI API from the local server. A ChatGPT Plus
subscription does not include API quota for this app. If refinement reports
that quota is unavailable, add credits or raise the budget for the API project
that owns `OPENAI_API_KEY`, then restart the app.

## Workbook support

The importer accepts standard `.xlsx` and `.csv` files. Legacy `.xls`, password-
protected or organization-encrypted workbooks must first be opened in Excel
and saved as an unencrypted `.xlsx` file.
