# BoLD App 1 - Numeric IDs

Standalone Next.js application for testing BoLD against a focused BOLA pattern.

## Live Deployment

Production: https://bold-app-1-numeric-ids.vercel.app

## Contract

- Route: `app/api/orders/[id]/route.ts`
- Method: `GET`
- ID shape: plain integer, for example `/api/orders/4021`
- Auth: request must come from a logged-in user
- Response: JSON includes top-level `ownerId`, such as `usr_101`
- Intentional flaw: any logged-in user can read any order by numeric ID, even when they do not own it

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Demo Users

All accounts use password `demo1234`.

- `maya@bold.test` -> `usr_101`
- `liam@bold.test` -> `usr_202`
- `sofia@bold.test` -> `usr_303`

## Test Probe

1. Log in as `maya@bold.test`.
2. Visit `/api/orders/4021`.
3. The response is Maya's order and includes `"ownerId":"usr_101"`.
4. Visit `/api/orders/8310`.
5. The response is Liam's order and includes `"ownerId":"usr_202"`, even though Maya is still logged in.

That last step is the intentional BOLA behavior for BoLD to detect.

## Deploy

This folder is self-contained and can be pushed as its own GitHub repository or imported directly into Vercel.
