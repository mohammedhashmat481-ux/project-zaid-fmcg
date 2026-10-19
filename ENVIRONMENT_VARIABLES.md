# inkCRM Environment Variables Guide

This document describes all environment configurations required for running **inkCRM** in development, staging, and production environments using **PostgreSQL**.

---

## 1. Backend Configuration (.env)

| Variable Name | Required | Default Fallback | Purpose / Security Guidelines |
| :--- | :---: | :--- | :--- |
| `PORT` | No | `5000` | Port the backend server binds to. |
| `NODE_ENV` | Yes | `development` | Set to `production` in live environments to hide stack traces and enable secure cookies. |
| `ALLOWED_ORIGINS` | Yes | `http://localhost:5173` | Comma-separated list of allowed origins for CORS. Do **not** allow wildcard `*` in production. |
| `DATABASE_URL` | No | Local embedded PGlite | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/inkcrm`). In production, points to your PostgreSQL database. In local dev, if omitted, automatically uses local embedded PGlite storage. |
| `ADMIN_EMAIL` | Optional | `admin@crm.com` (in dev) | Email address for initial Super Admin provisioning. |
| `ADMIN_PASSWORD` | Optional | `password` (in dev) | Password for initial Super Admin provisioning. If omitted in production, creation is safely skipped. |
| `JWT_SECRET` | Yes | - | Secret key used to sign JWT Access Tokens. Must be a strong, cryptographically secure key in production. |
| `JWT_REFRESH_SECRET`| Yes | - | Secret key used to sign JWT Refresh Tokens. Must be separate from `JWT_SECRET`. |
| `JWT_EXPIRES_IN` | No | `15m` | Lifetime of an access token. Default is 15 minutes. |
| `JWT_REFRESH_EXPIRES_IN`| No | `7d` | Lifetime of a refresh token. Default is 7 days. |
| `ENCRYPTION_KEY` | Yes | - | Used for cryptographic operations. Must be at least 16 characters. |
| `EMAIL_HOST` | No | - | SMTP Server host for outbound emails (e.g. `smtp.sendgrid.net`). |
| `EMAIL_PORT` | No | - | SMTP Port (e.g. `587` or `465`). |
| `EMAIL_USER` | No | - | SMTP Username. |
| `EMAIL_PASS` | No | - | SMTP Password. |
| `EMAIL_FROM` | No | `noreply@inkcrm.com`| Default email address for sender metadata. |
| `S3_ENDPOINT` | No | - | S3 storage endpoint URL (if using AWS S3 or S3-compatible cloud buckets). |
| `S3_ACCESS_KEY` | No | - | Access key for S3 bucket storage. |
| `S3_SECRET_KEY` | No | - | Secret key for S3 bucket storage. |
| `S3_BUCKET_NAME` | No | - | Name of the bucket (e.g. `inkcrm-documents`). |

---

## 2. Frontend Configuration (.env)

The frontend is built using Vite. All variables must be prefixed with `VITE_` to be exposed to the client.

| Variable Name | Required | Default Fallback | Purpose |
| :--- | :---: | :--- | :--- |
| `VITE_API_URL` | Yes | `http://localhost:5000/api/v1`| Full URL path of the backend REST endpoints. |
| `VITE_FILE_BASE_URL`| Yes | `http://localhost:5000` | Base URL used to load static assets and dynamic document file uploads. |

---

## 3. Environment Separation Checklist

1. **Development (`.env.development`)**:
   - Set `NODE_ENV=development`
   - Point `DATABASE_URL` to local PostgreSQL instance or leave unset for embedded PGlite engine.
   - Allowed origins: `http://localhost:5173`
   
2. **Production (`.env.production`)**:
   - Set `NODE_ENV=production`
   - Point `DATABASE_URL` to your production PostgreSQL database.
   - Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to provision the initial Super Admin user safely.
   - Allowed origins: `https://crm.company.com` (your secure client domain).
   - Expose a cryptographically strong `JWT_SECRET` and `ENCRYPTION_KEY`.
