# HubSpot Deals — API Integration Documentation

This document describes the HubSpot CRM API v3 integration used by the `hubspot-deals-etl` service to extract deal records from a HubSpot instance.

---

## Overview

The `hubspot-deals-etl` service integrates with the HubSpot CRM API v3 to extract deal pipeline data. The primary endpoint is the Deals object endpoint, which returns paginated deal records with all associated properties.

| API Endpoint                | Purpose                          | Version | Scope Required               | Usage    |
|-----------------------------|----------------------------------|---------|------------------------------|----------|
| `GET /crm/v3/objects/deals` | Paginated list of all deal records | v3    | `crm.objects.deals.read`     | Required |

---

## Authentication

### Method: Private App Access Token

HubSpot Private Apps generate a long-lived access token that is used for authentication. This token must be included in every API request.

**Header format:**
```http
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

**Required OAuth Scope:**
```
crm.objects.deals.read
```

> **Important:** Never commit your access token to version control. Store it in `.env` as `HUBSPOT_ACCESS_TOKEN`.

---

## Base URL

```
https://api.hubapi.com
```

---

## Deals Endpoint

### `GET /crm/v3/objects/deals`

Fetches a paginated list of deal records from the HubSpot portal.

**Full URL:**
```
https://api.hubapi.com/crm/v3/objects/deals
```

### Query Parameters

| Parameter    | Type    | Default | Description                                                    |
|--------------|---------|---------|----------------------------------------------------------------|
| `limit`      | integer | 100     | Max records per page (default: 100, max: 100)                  |
| `after`      | string  | —       | Cursor token returned by previous page for pagination          |
| `properties` | string  | —       | Comma-separated list of deal property names to include         |
| `archived`   | boolean | false   | Whether to include archived (deleted) deals in results         |

### All Available Deal Properties

The following properties should be requested in the `properties` parameter:

```
dealname, amount, dealstage, closedate, pipeline, hubspot_owner_id,
description, createdate, hs_lastmodifieddate, hs_deal_stage_probability,
hs_is_closed, hs_is_closed_won, num_associated_contacts,
num_notes, hs_priority, deal_currency_code, hs_closed_amount
```

### Sample Request

```http
GET https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,closedate,pipeline,hubspot_owner_id
Authorization: Bearer pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
Content-Type: application/json
```

### Sample Response (JSON)

```json
{
  "results": [
    {
      "id": "123456",
      "properties": {
        "dealname": "Acme Corp Deal",
        "amount": "50000",
        "dealstage": "closedwon",
        "closedate": "2024-12-31T00:00:00.000Z",
        "hubspot_owner_id": "789",
        "createdate": "2024-01-15T10:30:00.000Z",
        "hs_lastmodifieddate": "2024-06-01T08:00:00.000Z",
        "pipeline": "default",
        "description": "Enterprise software deal"
      },
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-06-01T08:00:00.000Z",
      "archived": false
    }
  ],
  "paging": {
    "next": {
      "after": "cursor_token_xyz",
      "link": "https://api.hubapi.com/crm/v3/objects/deals?after=cursor_token_xyz"
    }
  }
}
```

**Pagination:** When `paging.next.after` is present, pass its value as the `after` query parameter to retrieve the next page. When `paging` is absent or `paging.next` is null, all records have been retrieved.

---

## Rate Limits

| Tier         | Limit                             |
|--------------|-----------------------------------|
| Default      | 150 requests per 10 seconds       |
| Daily        | 250,000 requests per day          |
| Burst        | 100 requests per 10 seconds       |

**Best Practice:** Implement exponential backoff on 429 responses. Use the `Retry-After` header value (in seconds) as the base delay. See [Error Handling](#error-handling) below.

---

## Error Handling

| HTTP Code | Meaning                         | Handling Strategy                                                   |
|-----------|---------------------------------|---------------------------------------------------------------------|
| 401       | Invalid or expired access token | Abort extraction immediately; surface `AuthenticationError` to caller |
| 403       | Insufficient token scope        | Abort extraction immediately; surface `PermissionError` to caller    |
| 429       | Rate limit exceeded             | Backoff with exponential delay using `Retry-After` header; retry up to 5 times |
| 500       | HubSpot internal server error   | Retry up to 3 times with 5-second backoff; then fail the job         |
| 503       | HubSpot service unavailable     | Retry up to 3 times with 10-second backoff; then fail the job        |

### Retry Logic (Pseudocode)

```python
def retry_with_backoff(func, max_retries=3):
    for attempt in range(max_retries):
        try:
            return func()
        except RateLimitError as e:
            wait = e.retry_after or (2 ** attempt * 10)
            time.sleep(wait)
        except HubSpotAPIError as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(5 * (attempt + 1))
    raise Exception("Max retries exceeded")
```

---

## Data Extraction Flow

### Cursor-Based Pagination

```
Initial Request:
  GET /crm/v3/objects/deals?limit=100&properties=...

  Response: { results: [...100 deals], paging: { next: { after: "cursor_abc" } } }

Next Page:
  GET /crm/v3/objects/deals?limit=100&after=cursor_abc&properties=...

  Response: { results: [...] }
  (No `paging.next` means last page)
```

### Token Validation

Before starting extraction, make a lightweight call to verify the token:

```bash
curl -X GET "https://api.hubapi.com/crm/v3/objects/deals?limit=1" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json"
```

A `200 OK` confirms the token is valid and has the correct scope.

---

## Security Requirements

### Required Scope (Minimum)
```
crm.objects.deals.read
```
This scope is sufficient for all read operations on deal records.

### No Additional Scopes Needed
The extraction service only reads deal data. No write scopes (`crm.objects.deals.write`) are required.

### Token Storage
- Store token in environment variable: `HUBSPOT_ACCESS_TOKEN`
- Never hardcode or commit the token
- See `.env.example` for the expected format

---

## Debugging & Monitoring

### Request Headers for Debugging
```http
Authorization: Bearer <token>
Content-Type: application/json
User-Agent: HubSpot-Deals-ETL/1.0
```

### Useful Logging Points
- Log the request URL and `after` cursor on every page fetch (INFO level)
- Log the response status code and record count (INFO level)
- Log full error body on any non-2xx response (ERROR level)
- Track total pages fetched and cumulative record count

---

## Support Resources

- **HubSpot CRM API v3 Reference:** https://developers.hubspot.com/docs/api/crm/deals
- **Private Apps Guide:** https://developers.hubspot.com/docs/api/private-apps
- **Rate Limiting Guide:** https://developers.hubspot.com/docs/api/usage-details
- **HubSpot Developer Slack:** https://developers.hubspot.com/slack
