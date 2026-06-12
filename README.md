# KPI Appraisal Assistant

A local web application for capturing KPI achievements, refining them with
OpenAI, tracking completion, and exporting appraisal-ready Excel workbooks.

## Run locally

1. Copy `.env.example` to `.env`.
2. Add your OpenAI API key to `.env`.
3. Run:

```powershell
npm install
npm start
```

4. Open `http://localhost:3000`.

The API key stays on the server and is never sent to the browser. Draft KPI
data is stored in MongoDB. Browser local storage is used only as an offline
recovery cache.

## Docker

The Docker setup runs the application and MongoDB together:

```powershell
docker compose up --build -d
```

Open `http://localhost:3010`. MongoDB data is retained in the named
`mongo_data` volume.

Useful commands:

```powershell
docker compose logs -f app
docker compose down
docker compose down -v
```

The last command also deletes the MongoDB volume and should only be used when
you intentionally want to erase all KPI data.

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

## Workbook support

The importer accepts standard `.xlsx` and `.csv` files. Legacy `.xls`, password-
protected or organization-encrypted workbooks must first be opened in Excel
and saved as an unencrypted `.xlsx` file.
