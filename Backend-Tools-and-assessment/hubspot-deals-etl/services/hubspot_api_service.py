"""
hubspot_api_service.py

Production HubSpot CRM API v3 client for the deals extraction service.

Handles authentication, pagination, rate limiting with exponential backoff,
and structured error reporting via typed exceptions.
"""

import time
import logging
import requests
from typing import Optional
from loki_logger import get_logger

# ---------------------------------------------------------------------------
# Typed exceptions
# ---------------------------------------------------------------------------


class AuthenticationError(Exception):
    """Raised when the HubSpot access token is invalid or expired (401/403)."""


class RateLimitError(Exception):
    """Raised when HubSpot returns 429 Too Many Requests."""

    def __init__(self, message: str, retry_after: int = 10):
        super().__init__(message)
        self.retry_after = retry_after


class HubSpotAPIError(Exception):
    """Raised on unexpected non-2xx responses (5xx, etc.)."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


# ---------------------------------------------------------------------------
# HubSpot API client
# ---------------------------------------------------------------------------


class HubSpotAPIService:
    """
    Client for the HubSpot CRM API v3 Deals endpoint.

    All requests use a persistent `requests.Session` with the Authorization
    header pre-set. Retry logic handles 429 (rate limit) with exponential
    backoff, and 5xx errors are retried up to `max_retries` times.

    Usage:
        api = HubSpotAPIService(access_token="pat-na1-xxxx")
        if api.validate_credentials():
            page = api.get_deals(properties=["dealname", "amount"])
    """

    BASE_URL = "https://api.hubapi.com"
    # Properties we always request from the deals endpoint
    DEFAULT_PROPERTIES = [
        "dealname",
        "amount",
        "dealstage",
        "closedate",
        "pipeline",
        "hubspot_owner_id",
        "description",
        "createdate",
        "hs_lastmodifieddate",
        "hs_deal_stage_probability",
        "hs_is_closed",
        "hs_is_closed_won",
        "num_associated_contacts",
        "num_notes",
        "hs_priority",
        "deal_currency_code",
        "hs_closed_amount",
    ]

    def __init__(self, access_token: str, timeout: int = 30, max_retries: int = 3):
        """
        Initialise the API service with a private app access token.

        Args:
            access_token: HubSpot private app token (pat-na1-…).
            timeout:      HTTP request timeout in seconds (default 30).
            max_retries:  Max retry attempts on 5xx errors (default 3).
        """
        self.access_token = access_token
        self.timeout = timeout
        self.max_retries = max_retries
        self.logger = get_logger(__name__)

        # Persistent session — headers set once, reused on every request
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "HubSpot-Deals-ETL/1.0",
            }
        )

        self.logger.debug(
            "HubSpotAPIService initialised",
            extra={"operation": "init", "timeout": timeout, "max_retries": max_retries},
        )

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def validate_credentials(self) -> bool:
        """
        Make a lightweight authenticated request (limit=1) to verify the token.

        Returns:
            True if the token is valid and has the required scope.

        Raises:
            AuthenticationError: If the token is invalid (401) or lacks scope (403).
        """
        self.logger.info(
            "Validating HubSpot credentials",
            extra={"operation": "validate_credentials"},
        )
        try:
            # A limit=1 request is the cheapest way to verify auth + scope
            self._make_request("GET", "/crm/v3/objects/deals", params={"limit": 1})
            self.logger.info(
                "Credentials validated successfully",
                extra={"operation": "validate_credentials"},
            )
            return True
        except AuthenticationError:
            raise
        except Exception as exc:
            self.logger.error(
                "Credential validation failed",
                extra={"operation": "validate_credentials", "error": str(exc)},
            )
            raise AuthenticationError(
                f"Could not validate HubSpot credentials: {exc}"
            ) from exc

    def get_deals(
        self,
        properties: list[str] | None = None,
        after: str | None = None,
        limit: int = 100,
        include_archived: bool = False,
    ) -> dict:
        """
        Fetch one page of deal records from /crm/v3/objects/deals.

        Args:
            properties:       List of deal property names to request.
                              Defaults to DEFAULT_PROPERTIES if not supplied.
            after:            Cursor token from the previous page's paging.next.after.
            limit:            Records per page (max 100, default 100).
            include_archived: Whether to include archived deals.

        Returns:
            Raw HubSpot response dict with "results" and optional "paging" keys.

        Raises:
            AuthenticationError: On 401/403.
            RateLimitError:      On 429.
            HubSpotAPIError:     On 5xx or other non-2xx status.
        """
        props = properties or self.DEFAULT_PROPERTIES
        params: dict = {
            "limit": min(limit, 100),  # HubSpot hard cap: 100
            "properties": ",".join(props),
            "archived": str(include_archived).lower(),
        }
        if after:
            params["after"] = after

        self.logger.info(
            "Fetching deals page",
            extra={
                "operation": "get_deals",
                "after_cursor": after,
                "limit": params["limit"],
                "properties_count": len(props),
            },
        )

        response = self._make_request("GET", "/crm/v3/objects/deals", params=params)

        result_count = len(response.get("results", []))
        has_more = bool(response.get("paging", {}).get("next", {}).get("after"))
        self.logger.info(
            "Deals page fetched",
            extra={
                "operation": "get_deals",
                "records_in_page": result_count,
                "has_more": has_more,
                "next_cursor": response.get("paging", {}).get("next", {}).get("after"),
            },
        )

        return response

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _handle_rate_limit(self, retry_after: int) -> None:
        """
        Sleep for `retry_after` seconds to honour the rate limit.

        HubSpot sends a Retry-After header with the number of seconds to wait.
        We honour it with a minimum floor of 10 seconds.

        Args:
            retry_after: Seconds to wait before the next attempt.
        """
        wait = max(retry_after, 10)
        self.logger.warning(
            "Rate limit hit — sleeping before retry",
            extra={"operation": "rate_limit_backoff", "wait_seconds": wait},
        )
        time.sleep(wait)

    def _make_request(self, method: str, path: str, params: dict) -> dict:
        """
        Internal HTTP request wrapper with retry logic for rate limits and 5xx errors.

        - 429 responses sleep for `Retry-After` seconds (min 10 s) before retrying.
        - 5xx responses are retried up to `self.max_retries` times with a fixed
          5-second backoff between attempts.
        - 401/403 raise AuthenticationError immediately (no retry).
        - Every request/response pair is logged at INFO level.
        - Non-2xx response bodies are logged at ERROR level.

        Args:
            method: HTTP method string, e.g. "GET".
            path:   API path, e.g. "/crm/v3/objects/deals".
            params: Query parameters dict.

        Returns:
            Parsed JSON response as a dict.

        Raises:
            AuthenticationError: On 401 or 403.
            RateLimitError:      On 429 after exhausting retries.
            HubSpotAPIError:     On 5xx or other unexpected status codes.
        """
        url = f"{self.BASE_URL}{path}"
        attempts = 0

        while True:
            attempts += 1
            self.logger.info(
                "HTTP request",
                extra={
                    "operation": "make_request",
                    "method": method,
                    "url": url,
                    "attempt": attempts,
                    "params": {k: v for k, v in params.items() if k != "properties"},
                },
            )

            try:
                response = self.session.request(
                    method, url, params=params, timeout=self.timeout
                )
            except requests.exceptions.Timeout as exc:
                self.logger.error(
                    "Request timed out",
                    extra={"operation": "make_request", "url": url, "attempt": attempts},
                )
                raise HubSpotAPIError(f"Request timed out after {self.timeout}s") from exc
            except requests.exceptions.ConnectionError as exc:
                self.logger.error(
                    "Connection error",
                    extra={"operation": "make_request", "url": url, "error": str(exc)},
                )
                raise HubSpotAPIError(f"Connection error: {exc}") from exc

            status = response.status_code
            self.logger.info(
                "HTTP response received",
                extra={
                    "operation": "make_request",
                    "status_code": status,
                    "url": url,
                    "attempt": attempts,
                },
            )

            # --- Auth errors (do not retry) ----------------------------------
            if status in (401, 403):
                body = self._safe_json(response)
                self.logger.error(
                    "Authentication / authorisation error",
                    extra={
                        "operation": "make_request",
                        "status_code": status,
                        "body": body,
                    },
                )
                if status == 401:
                    raise AuthenticationError(
                        f"Invalid or expired HubSpot access token (HTTP 401). "
                        f"Response: {body}"
                    )
                raise AuthenticationError(
                    f"Insufficient token scope (HTTP 403). "
                    f"Ensure the token has 'crm.objects.deals.read'. Response: {body}"
                )

            # --- Rate limit --------------------------------------------------
            if status == 429:
                retry_after = int(response.headers.get("Retry-After", 10))
                if attempts > 5:
                    raise RateLimitError(
                        "Rate limit exceeded and max retries reached", retry_after
                    )
                self._handle_rate_limit(retry_after)
                continue  # retry

            # --- Server errors (retry up to max_retries) ---------------------
            if status >= 500:
                body = self._safe_json(response)
                self.logger.error(
                    "HubSpot server error",
                    extra={
                        "operation": "make_request",
                        "status_code": status,
                        "body": body,
                        "attempt": attempts,
                    },
                )
                if attempts >= self.max_retries:
                    raise HubSpotAPIError(
                        f"HubSpot returned HTTP {status} after {attempts} attempts. "
                        f"Response: {body}",
                        status_code=status,
                    )
                backoff = 5 * attempts
                self.logger.warning(
                    f"Retrying after {backoff}s (attempt {attempts}/{self.max_retries})",
                    extra={"operation": "make_request", "backoff_seconds": backoff},
                )
                time.sleep(backoff)
                continue  # retry

            # --- Unexpected non-2xx -----------------------------------------
            if not response.ok:
                body = self._safe_json(response)
                self.logger.error(
                    "Unexpected non-2xx response",
                    extra={
                        "operation": "make_request",
                        "status_code": status,
                        "body": body,
                    },
                )
                raise HubSpotAPIError(
                    f"Unexpected HTTP {status} from HubSpot. Response: {body}",
                    status_code=status,
                )

            # --- Success -----------------------------------------------------
            return response.json()

    @staticmethod
    def _safe_json(response: requests.Response) -> dict | str:
        """Parse response JSON safely; return raw text if parsing fails."""
        try:
            return response.json()
        except Exception:
            return response.text[:500]  # Truncate to avoid huge log lines
