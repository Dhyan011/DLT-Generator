# HubSpot Deals ETL — REST API Documentation

This document describes all REST endpoints exposed by the `hubspot-deals-etl` service for managing HubSpot deal extraction jobs.

---

## Base URL

```
http://localhost:5200/api/v1
```

Interactive API docs are available at `/docs/` when the service is running.

---

## Authentication

All endpoints are internal service APIs. Authentication is assumed to be handled at the API gateway or network layer. No per-request auth headers are required by this service itself.

---

## Error Response Format

All errors return a consistent JSON body:

```json
{
  "error": "Human-readable error message",
  "code": 400
}
```

---

## Endpoints

### `GET /health`

Health check endpoint. Returns service operational status.

**Response — 200 OK**
```json
{
  "status": "ok",
  "service": "hubspot-deals-etl",
  "version": "1.0.0",
  "timestamp": "2024-07-01T12:00:00Z"
}
```

---

### `POST /scan/start`

Initiates a new HubSpot deals extraction job.

**Request Body**
```json
{
  "access_token": "pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "tenant_id": "acme-corp",
  "properties": ["dealname", "amount", "dealstage", "closedate"],
  "include_archived": false
}
```

| Field             | Type     | Required | Description                                                    |
|-------------------|----------|----------|----------------------------------------------------------------|
| `access_token`    | string   | Yes      | HubSpot Private App access token                               |
| `tenant_id`       | string   | Yes      | Tenant identifier for multi-tenant isolation                   |
| `properties`      | string[] | No       | Deal properties to extract (defaults to all standard fields)   |
| `include_archived`| boolean  | No       | Whether to include archived deals (default: `false`)           |

**Response — 202 Accepted**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "tenant_id": "acme-corp",
  "started_at": "2024-07-01T12:00:00Z"
}
```

**Error Responses**

| Code | Reason                                  |
|------|-----------------------------------------|
| 400  | Missing `access_token` or `tenant_id`   |
| 401  | Invalid or revoked HubSpot access token |
| 422  | Malformed request body                  |

---

### `GET /scan/status/{job_id}`

Returns the current status and progress of an extraction job.

**Path Parameters**

| Parameter | Type   | Description           |
|-----------|--------|-----------------------|
| `job_id`  | UUID   | The extraction job ID |

**Response — 200 OK**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "in_progress",
  "tenant_id": "acme-corp",
  "records_extracted": 142,
  "current_page": 2,
  "started_at": "2024-07-01T12:00:00Z",
  "updated_at": "2024-07-01T12:02:15Z"
}
```

**Job Status Values**

```
pending → in_progress → completed
                      → failed
                      → cancelled
```

**Error Responses**

| Code | Reason                       |
|------|------------------------------|
| 404  | Job ID not found             |

---

### `GET /scan/result/{job_id}`

Returns paginated extracted deal records for a completed job.

**Path Parameters**

| Parameter | Type   | Description           |
|-----------|--------|-----------------------|
| `job_id`  | UUID   | The extraction job ID |

**Query Parameters**

| Parameter | Type    | Default | Description                  |
|-----------|---------|---------|------------------------------|
| `limit`   | integer | 100     | Records per page (max: 1000) |
| `offset`  | integer | 0       | Pagination offset            |

**Response — 200 OK**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "total_records": 5,
  "limit": 100,
  "offset": 0,
  "data": [
    {
      "deal_id": "123456",
      "deal_name": "Acme Corp Deal",
      "amount": 50000.00,
      "deal_stage": "closedwon",
      "close_date": "2024-12-31",
      "_extracted_at": "2024-07-01T12:02:00Z",
      "_scan_id": "550e8400-e29b-41d4-a716-446655440000",
      "_tenant_id": "acme-corp"
    }
  ]
}
```

**Error Responses**

| Code | Reason                                   |
|------|------------------------------------------|
| 404  | Job not found                            |
| 409  | Job is not yet completed (still running) |

---

### `POST /scan/cancel/{job_id}`

Cancels a pending or in-progress extraction job.

**Path Parameters**

| Parameter | Type   | Description                  |
|-----------|--------|------------------------------|
| `job_id`  | UUID   | The extraction job to cancel |

**Response — 200 OK**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "cancelled",
  "message": "Job successfully cancelled."
}
```

**Error Responses**

| Code | Reason                                                     |
|------|------------------------------------------------------------|
| 404  | Job not found                                              |
| 409  | Job is already completed, failed, or cancelled             |

---

### `DELETE /scan/remove/{job_id}`

Permanently deletes all extracted data and job metadata for the given job.

**Path Parameters**

| Parameter | Type   | Description                      |
|-----------|--------|----------------------------------|
| `job_id`  | UUID   | The extraction job to delete     |

**Response — 204 No Content**

No response body is returned on success.

**Error Responses**

| Code | Reason               |
|------|----------------------|
| 404  | Job not found        |

---

### `GET /jobs/jobs`

Lists all extraction jobs with optional pagination and tenant filtering.

**Query Parameters**

| Parameter   | Type    | Default | Description                                      |
|-------------|---------|---------|--------------------------------------------------|
| `limit`     | integer | 50      | Number of jobs to return                         |
| `offset`    | integer | 0       | Pagination offset                                |
| `tenant_id` | string  | —       | Filter by tenant (optional)                      |

**Response — 200 OK**
```json
{
  "total": 12,
  "limit": 50,
  "offset": 0,
  "jobs": [
    {
      "job_id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "completed",
      "tenant_id": "acme-corp",
      "records_extracted": 5,
      "started_at": "2024-07-01T12:00:00Z",
      "updated_at": "2024-07-01T12:05:00Z"
    }
  ]
}
```

---

### `GET /jobs/statistics`

Returns aggregated metrics across all jobs.

**Response — 200 OK**
```json
{
  "total_jobs": 12,
  "completed": 9,
  "failed": 1,
  "cancelled": 2,
  "in_progress": 0,
  "total_records_extracted": 847,
  "average_records_per_job": 94.1
}
```

---

## Edge Case Behavior

| Scenario                                | Endpoint                       | Expected Code |
|-----------------------------------------|--------------------------------|---------------|
| Empty or invalid `access_token`         | `POST /scan/start`             | 401           |
| Non-existent `job_id` in status call    | `GET /scan/status/<id>`        | 404           |
| Retrieve results for in-progress job    | `GET /scan/result/<id>`        | 409           |
| Cancel an already-completed job         | `POST /scan/cancel/<id>`       | 409           |
| Malformed JSON body                     | `POST /scan/start`             | 400           |
| Missing required field in body          | `POST /scan/start`             | 422           |

---

## Example Workflows

### Full Extraction Workflow

```bash
# 1. Start extraction
curl -X POST http://localhost:5200/api/v1/scan/start \
  -H "Content-Type: application/json" \
  -d '{
    "access_token": "pat-na1-xxxx",
    "tenant_id": "test-tenant",
    "properties": ["dealname","amount","dealstage","closedate","pipeline"]
  }'
# → 202 { "job_id": "550e8400-..." }

# 2. Poll status
curl http://localhost:5200/api/v1/scan/status/550e8400-...
# → 200 { "status": "in_progress", "records_extracted": 142 }

# 3. Retrieve results
curl "http://localhost:5200/api/v1/scan/result/550e8400-...?limit=100&offset=0"
# → 200 { "data": [...] }

# 4. Clean up
curl -X DELETE http://localhost:5200/api/v1/scan/remove/550e8400-...
# → 204
```

### Health Check

```bash
curl http://localhost:5200/api/v1/health
# → 200 { "status": "ok" }
```
