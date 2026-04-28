# HubSpot Deals — Database Schema Documentation

This document defines the PostgreSQL schema for storing deal records extracted from the HubSpot CRM API, including table structure, indexes, type mappings, and multi-tenant isolation strategy.

---

## Overview

All extracted HubSpot deal records are stored in the `hubspot_deals` table. This table is designed for:
- **Multi-tenancy**: Every row is scoped to a `_tenant_id`, enabling complete data isolation between tenants
- **Idempotency**: The `UNIQUE(deal_id, _tenant_id)` constraint prevents duplicate records on re-extraction
- **Auditability**: ETL metadata columns (`_extracted_at`, `_scan_id`) allow tracing each record back to an extraction job

---

## CREATE TABLE Statement

```sql
CREATE TABLE hubspot_deals (
    -- Primary key
    id                          BIGSERIAL PRIMARY KEY,

    -- HubSpot identity
    deal_id                     VARCHAR(64) NOT NULL,

    -- Core deal fields
    deal_name                   VARCHAR(512),
    amount                      NUMERIC(18, 2),
    deal_stage                  VARCHAR(128),
    pipeline                    VARCHAR(128),
    close_date                  DATE,
    description                 TEXT,
    owner_id                    VARCHAR(64),
    deal_currency_code          VARCHAR(8),
    is_closed                   BOOLEAN,
    is_closed_won               BOOLEAN,
    deal_stage_probability      NUMERIC(5, 4),
    num_associated_contacts     INTEGER,
    hs_priority                 VARCHAR(32),

    -- Timestamps from HubSpot
    hs_created_at               TIMESTAMPTZ,
    hs_updated_at               TIMESTAMPTZ,

    -- ETL metadata
    _extracted_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _scan_id                    UUID NOT NULL,
    _tenant_id                  VARCHAR(128) NOT NULL,

    -- Uniqueness constraint per tenant
    CONSTRAINT uq_deal_per_tenant UNIQUE (deal_id, _tenant_id)
);
```

---

## Column Reference

| Column                    | Type              | Nullable | Description                                           |
|---------------------------|-------------------|----------|-------------------------------------------------------|
| `id`                      | BIGSERIAL         | No       | Internal surrogate primary key (auto-increment)       |
| `deal_id`                 | VARCHAR(64)       | No       | HubSpot deal ID (string numeric, e.g. `"123456"`)     |
| `deal_name`               | VARCHAR(512)      | Yes      | Deal name from `dealname` property                    |
| `amount`                  | NUMERIC(18, 2)    | Yes      | Deal value; preserves decimal precision               |
| `deal_stage`              | VARCHAR(128)      | Yes      | Pipeline stage identifier (e.g. `closedwon`)          |
| `pipeline`                | VARCHAR(128)      | Yes      | Pipeline identifier (e.g. `default`)                  |
| `close_date`              | DATE              | Yes      | Expected or actual close date (time stripped)         |
| `description`             | TEXT              | Yes      | Free-text deal description                            |
| `owner_id`                | VARCHAR(64)       | Yes      | HubSpot owner user ID                                 |
| `deal_currency_code`      | VARCHAR(8)        | Yes      | ISO 4217 currency code (e.g. `USD`, `EUR`)            |
| `is_closed`               | BOOLEAN           | Yes      | Whether the deal has been closed                      |
| `is_closed_won`           | BOOLEAN           | Yes      | Whether the deal was closed as won                    |
| `deal_stage_probability`  | NUMERIC(5, 4)     | Yes      | Win probability (0.0000 – 1.0000)                     |
| `num_associated_contacts` | INTEGER           | Yes      | Count of contacts linked to this deal                 |
| `hs_priority`             | VARCHAR(32)       | Yes      | Deal priority label (e.g. `high`, `medium`, `low`)    |
| `hs_created_at`           | TIMESTAMPTZ       | Yes      | Timestamp when deal was created in HubSpot            |
| `hs_updated_at`           | TIMESTAMPTZ       | Yes      | Timestamp of last modification in HubSpot             |
| `_extracted_at`           | TIMESTAMPTZ       | No       | UTC timestamp when this row was written by the ETL    |
| `_scan_id`                | UUID              | No       | Extraction job ID (links row back to job record)      |
| `_tenant_id`              | VARCHAR(128)      | No       | Tenant identifier for multi-tenant isolation          |

---

## Indexes

```sql
-- Tenant isolation (all queries must be scoped by tenant)
CREATE INDEX idx_deals_tenant         ON hubspot_deals (_tenant_id);

-- Scan lookup (used during extraction progress checks)
CREATE INDEX idx_deals_scan           ON hubspot_deals (_scan_id);

-- Time-based range queries
CREATE INDEX idx_deals_close_date     ON hubspot_deals (close_date);
CREATE INDEX idx_deals_extracted_at   ON hubspot_deals (_extracted_at);

-- Deal stage filtering
CREATE INDEX idx_deals_stage          ON hubspot_deals (deal_stage);

-- Composite for tenant + stage reporting (most common query pattern)
CREATE INDEX idx_deals_tenant_stage   ON hubspot_deals (_tenant_id, deal_stage);
```

### Index Rationale

| Index                     | Query Pattern                                             |
|---------------------------|-----------------------------------------------------------|
| `idx_deals_tenant`        | All queries: `WHERE _tenant_id = :tenant_id`             |
| `idx_deals_scan`          | Job progress: `WHERE _scan_id = :job_id`                  |
| `idx_deals_close_date`    | Date range reports: `WHERE close_date BETWEEN x AND y`   |
| `idx_deals_extracted_at`  | Incremental loads: `WHERE _extracted_at > :last_run`     |
| `idx_deals_stage`         | Stage filters: `WHERE deal_stage = 'closedwon'`          |
| `idx_deals_tenant_stage`  | Tenant-scoped stage reports (covers both columns)        |

---

## HubSpot → PostgreSQL Type Mapping

| HubSpot Property Type | PostgreSQL Type      | Conversion Notes                                       |
|-----------------------|----------------------|--------------------------------------------------------|
| `string`              | `VARCHAR` / `TEXT`   | Use `VARCHAR(N)` when max length is known; `TEXT` otherwise |
| `number`              | `NUMERIC(18, 2)`     | Parse string `"50000"` → `Decimal("50000")`; `NULL` if blank |
| `datetime`            | `TIMESTAMPTZ`        | Parse ISO 8601; always store with timezone             |
| `date`                | `DATE`               | Strip time component from datetime string              |
| `boolean`             | `BOOLEAN`            | Convert `"true"` / `"false"` string → Python `bool`   |
| `enumeration`         | `VARCHAR(128)`       | Store raw enum string value (e.g. `"closedwon"`)       |

### Type Conversion Examples

```python
# number → NUMERIC
amount = float(props["amount"]) if props.get("amount") else None

# datetime → TIMESTAMPTZ
from datetime import datetime
def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

# date → DATE
from datetime import date
def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).date()

# boolean → BOOLEAN
is_closed = props.get("hs_is_closed") == "true"
```

---

## Multi-Tenant Isolation Strategy

Every query in the service layer **must** include a `WHERE _tenant_id = :tenant_id` clause. No cross-tenant access is permitted at the query layer.

### Rules

1. **Scoped writes:** Every inserted row must include a `_tenant_id` value set to the requesting tenant's identifier.
2. **Scoped reads:** All `SELECT` queries must filter by `_tenant_id`.
3. **Scoped deletes:** Job cleanup must only delete rows matching the job's `_tenant_id`.
4. **No wildcard tenant queries:** Queries without a `_tenant_id` filter are forbidden in production code.

### Future: Row-Level Security (RLS)

For PostgreSQL 15+ deployments, enable RLS for an additional defense-in-depth layer:

```sql
-- Enable RLS
ALTER TABLE hubspot_deals ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see their own tenant's data
CREATE POLICY tenant_isolation ON hubspot_deals
    USING (_tenant_id = current_setting('app.tenant_id'));
```

This allows the database itself to enforce tenant isolation, even if application-layer filters are accidentally omitted.

---

## Common Queries

### Count deals by stage for a tenant

```sql
SELECT deal_stage, COUNT(*) AS deal_count, SUM(amount) AS total_amount
FROM hubspot_deals
WHERE _tenant_id = 'acme-corp'
GROUP BY deal_stage
ORDER BY total_amount DESC NULLS LAST;
```

### Get all deals for a completed extraction job

```sql
SELECT deal_id, deal_name, amount, deal_stage, close_date
FROM hubspot_deals
WHERE _scan_id = '550e8400-e29b-41d4-a716-446655440000'
  AND _tenant_id = 'acme-corp'
ORDER BY _extracted_at DESC;
```

### Paginated results for API response

```sql
SELECT *
FROM hubspot_deals
WHERE _scan_id = :scan_id
  AND _tenant_id = :tenant_id
ORDER BY id ASC
LIMIT :limit OFFSET :offset;
```

---

## Migration Notes

- Apply schema using `psql` or a migration tool (e.g. Alembic, Flyway)
- The `BIGSERIAL` primary key supports up to 9.2 × 10¹⁸ rows, suitable for any scale
- `NUMERIC(18, 2)` for `amount` avoids floating-point precision issues with monetary values
- `NUMERIC(5, 4)` for `deal_stage_probability` supports values from 0.0000 to 9.9999 (in practice 0–1)
