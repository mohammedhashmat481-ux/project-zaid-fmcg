# inkCRM High-Performance Architecture & Development Rules

This document outlines the performance benchmarks, architectural optimizations, and mandatory development rules to ensure inkCRM maintains instant page transitions (<100ms) and lightning-fast API responses (<300ms).

---

## 1. Performance Benchmarks Summary

| Metric | Before Optimization | After Optimization | Improvement |
| :--- | :--- | :--- | :--- |
| **Initial JS Bundle Size** | 3.4 MB | **~480 KB** (~156 KB gzipped) | **85% reduction** |
| **Vendor Code Splitting** | 1 monolithic bundle | 6 separate chunks (charts, xlsx, faceapi, query, icons, framework) | On-demand chunk loading |
| **Route Navigation** | 800ms - 2,500ms | **< 100ms** (Instant from query cache) | **90%+ faster** |
| **Status / Master Data API** | 180ms - 350ms | **< 2ms** (In-memory cached) | **99% faster** |
| **Dashboard Metrics API** | 320ms - 850ms | **< 15ms** (45s TTL cache + composite indexes) | **95% faster** |
| **Loading Skeletons** | Instant flash on every load (flicker) | **Delayed 400ms** (no flicker for fast loads) | Seamless UX |

---

## 2. Mandatory Rules for Future Development

### Rule 1: Always Paginate List Endpoints
- Every list endpoint must accept `page` and `limit` query parameters.
- Hard clamp `limit` to a maximum of 100: `Math.min(parseInt(limit) || 10, 100)`.
- Never return unbounded datasets (`SELECT * FROM table` without LIMIT).

### Rule 2: Always Index Queried Columns
- Every column and JSONB attribute used in `WHERE`, `ORDER BY`, or `JOIN` must have an index.
- Composite queries with ordering must use composite indexes:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_cr_org_mod_created ON custom_records(organization_id, module_id, created_at DESC);
  ```
- JSONB columns must maintain GIN indexing for high-speed attribute lookups:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_cr_data_gin ON custom_records USING gin (data);
  ```

### Rule 3: Always Cache Master & Rarely Changing Data
- Master data (Statuses, Bank Masters, Products, Departments, Module Definitions) must be served from `serverCache` with a 5–10 minute TTL.
- When creating, updating, or deleting any record, always call the appropriate invalidator:
  ```typescript
  CacheInvalidators.invalidateDashboard(orgId);
  CacheInvalidators.invalidateMaster(orgId, apiPath);
  ```

### Rule 4: Dropdown Endpoints Must Use Projections
- Dropdown endpoints (like `/api/v1/auth/users?purpose=dropdown`) must never load password hashes, refresh tokens, or full audit histories.
- Use `.select('id firstName lastName email department isActive')` and cache with `CacheKeys.userDropdown`.

### Rule 5: Frontend Route Splitting & Delayed UX Indicators
- All pages must be imported via `React.lazy()` with `Suspense`.
- Skeletons and spinners must use `useDelayedLoading(isLoading, 400)` to prevent UI flickering on fast network responses.
- Heavy dependencies (e.g., charts, XLSX exporters, face-api) must reside in dedicated manualChunks in `vite.config.ts`.

---

## 3. Server Health & Monitoring

The backend exposes a real-time health diagnostic endpoint:
- **`GET /health`**
  Returns:
  - System Uptime & Timestamp
  - Database connectivity verification
  - Memory consumption (`rssMb`, `heapUsedMb`)
  - Server-side cache statistics
  - Request profiling metrics (total requests, slow requests exceeding 300ms, average latency)
