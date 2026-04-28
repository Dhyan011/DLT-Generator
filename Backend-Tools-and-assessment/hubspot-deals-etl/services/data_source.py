import dlt
import logging
from typing import Dict, List, Any, Iterator, Optional, Callable
from datetime import datetime, timezone, date
from .hubspot_api_service import HubSpotAPIService
from loki_logger import get_logger, log_business_event, log_security_event

# ---------------------------------------------------------------------------
# Type conversion helpers
# ---------------------------------------------------------------------------


def _parse_datetime(value: Optional[str]) -> Optional[str]:
    """Parse an ISO 8601 datetime string and return UTC-normalised isoformat."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
    except (ValueError, AttributeError):
        return None


def _parse_date(value: Optional[str]) -> Optional[str]:
    """Parse a datetime string and return only the DATE portion (YYYY-MM-DD)."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
    except (ValueError, AttributeError):
        return None


def _safe_float(value: Optional[str]) -> Optional[float]:
    """Convert a string to float; returns None if blank or unconvertible."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _safe_int(value: Optional[str]) -> Optional[int]:
    """Convert a string to int; returns None if blank or unconvertible."""
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return None


def transform_deal(raw: dict, tenant_id: str, scan_id: str) -> dict:
    """
    Transform a raw HubSpot deal record into a DB-safe flat dict.

    All property lookups are safe (None returned on missing keys).
    Type conversion follows the HubSpot → PostgreSQL mapping in database-schema.md.

    Args:
        raw:       Raw deal object from HubSpot API response (one element of "results").
        tenant_id: Caller-supplied tenant identifier for multi-tenant isolation.
        scan_id:   Extraction job ID, stored as ETL metadata on every row.

    Returns:
        Flat dict ready to be yielded by the DLT resource generator.
    """
    props = raw.get("properties") or {}
    return {
        # HubSpot identity
        "deal_id":                  raw["id"],
        # Core deal fields
        "deal_name":                props.get("dealname"),
        "amount":                   _safe_float(props.get("amount")),
        "deal_stage":               props.get("dealstage"),
        "pipeline":                 props.get("pipeline"),
        "close_date":               _parse_date(props.get("closedate")),
        "description":              props.get("description"),
        "owner_id":                 props.get("hubspot_owner_id"),
        "deal_currency_code":       props.get("deal_currency_code"),
        # Boolean fields — HubSpot returns them as "true"/"false" strings
        "is_closed":                props.get("hs_is_closed") == "true",
        "is_closed_won":            props.get("hs_is_closed_won") == "true",
        # Numeric fields with safe coercion
        "deal_stage_probability":   _safe_float(props.get("hs_deal_stage_probability")),
        "num_associated_contacts":  _safe_int(props.get("num_associated_contacts")),
        "hs_priority":              props.get("hs_priority"),
        # Timestamps from HubSpot
        "hs_created_at":            _parse_datetime(props.get("createdate")),
        "hs_updated_at":            _parse_datetime(props.get("hs_lastmodifieddate")),
        # ETL metadata
        "_extracted_at":            datetime.now(timezone.utc).isoformat(),
        "_scan_id":                 scan_id,
        "_tenant_id":               tenant_id,
    }

def create_data_source(
    job_config: Dict[str, Any],
    auth_config: Dict[str, Any],
    filters: Dict[str, Any],
    checkpoint_callback: Optional[Callable] = None,
    check_cancel_callback: Optional[Callable] = None,
    check_pause_callback: Optional[Callable] = None,  # Add pause callback parameter
    resume_from: Optional[Dict[str, Any]] = None,
):
    """
    Create DLT source function for Hubspot_Deals data extraction with checkpoint support
    """
    logger = get_logger(__name__)
    api_service = HubSpotAPIService(access_token=auth_config.get("accessToken", ""))

    access_token = auth_config.get("accessToken")
    if not access_token:
        raise ValueError("No access token found in auth configuration")

    organization_id = job_config.get("organizationId")
    if not organization_id:
        raise ValueError("No organization ID found in job configuration")

    #  To Be Removed Later
    logger.info(
        "Starting Hubspot_Deals data extraction",
        extra={
            "organization_id": organization_id,
            "filters": filters,
            "auth_config": auth_config,
            "job_config": job_config,
        },
    )

    @dlt.resource(
        name="hubspot_deals",
        write_disposition="merge",
        primary_key=["deal_id", "_tenant_id"],  # composite uniqueness per tenant
    )
    def get_main_data() -> Iterator[Dict[str, Any]]:
        """
        Extract main data from Hubspot_Deals API with checkpoint support

        TODO: Customize for Hubspot_Deals:
        - Update resource name and primary_key
        - Adjust API calls and pagination
        - Modify data transformation logic
        """

        # Initialize state
        if resume_from:
            after = resume_from.get("cursor")
            page_count = resume_from.get("page_number", 0)
            total_records = resume_from.get("records_processed", 0)
            logger.info(
                "Resuming data extraction",
                extra={
                    "operation": "data_extraction",
                    "page_number": page_count + 1,
                    "total_processed": total_records,
                },
            )
        else:
            after = None
            page_count = 0
            total_records = 0
            logger.info(
                "Starting fresh data extraction",
                extra={"operation": "data_extraction", "source": "hubspot_deals"},
            )

        # Configuration
        checkpoint_interval = 10
        cancel_check_interval = 1
        pause_check_interval = 1  # Check for pause more frequently than cancel
        job_id = filters.get("scan_id", "unknown")

        while page_count < 1000:  # Safety limit
            try:
                # Check for cancellation
                if page_count % cancel_check_interval == 0:
                    if check_cancel_callback and check_cancel_callback(job_id):
                        logger.info(
                            "Extraction cancelled by user",
                            extra={
                                "operation": "data_extraction",
                                "job_id": job_id,
                                "page_number": page_count + 1,
                                "total_processed": total_records,
                            },
                        )

                        # Save cancellation checkpoint
                        if checkpoint_callback:
                            try:
                                cancel_checkpoint = {
                                    "phase": "main_data_cancelled",
                                    "records_processed": total_records,
                                    "cursor": after,
                                    "page_number": page_count,
                                    "batch_size": 100,
                                    "checkpoint_data": {
                                        "cancellation_reason": "user_requested",
                                        "cancelled_at_page": page_count,
                                        "service": "hubspot_deals",
                                    },
                                }
                                checkpoint_callback(job_id, cancel_checkpoint)
                            except Exception as e:
                                logger.warning(
                                    "Failed to save cancellation checkpoint",
                                    extra={"job_id": job_id, "error": str(e)},
                                )
                        break

                # Check for pause request
                if page_count % pause_check_interval == 0:
                    if check_pause_callback and check_pause_callback(job_id):
                        logger.info(
                            "Extraction paused by user",
                            extra={
                                "operation": "data_extraction",
                                "job_id": job_id,
                                "page_number": page_count + 1,
                                "total_processed": total_records,
                            },
                        )

                        # Save pause checkpoint - this allows resuming from exact position
                        if checkpoint_callback:
                            try:
                                pause_checkpoint = {
                                    "phase": "main_data_paused",
                                    "records_processed": total_records,
                                    "cursor": after,
                                    "page_number": page_count,
                                    "batch_size": 1,
                                    "checkpoint_data": {
                                        "pause_reason": "user_requested",
                                        "paused_at_page": page_count,
                                        "paused_at": datetime.now(
                                            timezone.utc
                                        ).isoformat(),
                                        "service": "hubspot_deals",
                                    },
                                }
                                checkpoint_callback(job_id, pause_checkpoint)

                                logger.info(
                                    "Pause checkpoint saved",
                                    extra={
                                        "operation": "data_extraction",
                                        "job_id": job_id,
                                        "page_number": page_count,
                                        "total_processed": total_records,
                                    },
                                )
                            except Exception as e:
                                logger.warning(
                                    "Failed to save pause checkpoint",
                                    extra={"job_id": job_id, "error": str(e)},
                                )

                        # Exit gracefully - this allows the job to be resumed later
                        break

                logger.debug(
                    "Fetching data page",
                    extra={
                        "operation": "data_extraction",
                        "job_id": job_id,
                        "page_number": page_count + 1,
                    },
                )

                # Fetch one page of deals from HubSpot CRM API v3
                properties = filters.get("properties") or None
                include_archived = filters.get("include_archived", False)
                data = api_service.get_deals(
                    properties=properties,
                    after=after,
                    limit=100,
                    include_archived=include_archived,
                )

                page_records = 0

                # Transform and yield HubSpot deal records
                raw_results = data.get("results", [])
                if raw_results:
                    tenant_id = filters.get("organization_id", "unknown")
                    for record in raw_results:
                        # Check for pause/cancel even within record processing
                        if check_pause_callback and check_pause_callback(job_id):
                            logger.info(
                                "Extraction paused mid-page",
                                extra={
                                    "operation": "data_extraction",
                                    "job_id": job_id,
                                    "page_number": page_count + 1,
                                    "records_in_page": page_records,
                                    "total_processed": total_records + page_records,
                                },
                            )
                            if checkpoint_callback:
                                try:
                                    mid_page_checkpoint = {
                                        "phase": "main_data_paused_mid_page",
                                        "records_processed": total_records + page_records,
                                        "cursor": after,
                                        "page_number": page_count,
                                        "batch_size": 100,
                                        "checkpoint_data": {
                                            "pause_reason": "user_requested_mid_page",
                                            "paused_at_page": page_count,
                                            "records_completed_in_page": page_records,
                                            "paused_at": datetime.now(timezone.utc).isoformat(),
                                            "service": "hubspot_deals",
                                        },
                                    }
                                    checkpoint_callback(job_id, mid_page_checkpoint)
                                except Exception as e:
                                    logger.warning(
                                        "Failed to save mid-page pause checkpoint",
                                        extra={"job_id": job_id, "error": str(e)},
                                    )
                            return  # Exit the generator

                        # Transform raw HubSpot deal → flat DB-safe record
                        transformed = transform_deal(
                            raw=record,
                            tenant_id=tenant_id,
                            scan_id=job_id,
                        )
                        # Add page-level metadata (not persisted to DB but useful
                        # for debugging)
                        transformed["_page_number"] = page_count + 1

                        yield transformed
                        page_records += 1

                # Update counters
                total_records += page_records
                page_count += 1

                # Save checkpoint periodically
                if checkpoint_callback and page_count % checkpoint_interval == 0:
                    try:
                        # TODO: Update pagination logic based on Hubspot_Deals API
                        next_cursor = None
                        if (
                            data.get("paging")
                            and data["paging"].get("next")
                            and data["paging"]["next"].get("after")
                        ):
                            next_cursor = data["paging"]["next"]["after"]

                        checkpoint_data = {
                            "phase": "main_data",
                            "records_processed": total_records,
                            "cursor": next_cursor,
                            "page_number": page_count,
                            "batch_size": 100,
                            "checkpoint_data": {
                                "pages_processed": page_count,
                                "last_page_records": page_records,
                                "service": "hubspot_deals",
                            },
                        }

                        checkpoint_callback(job_id, checkpoint_data)

                        logger.debug(
                            "Checkpoint saved",
                            extra={
                                "operation": "data_extraction",
                                "job_id": job_id,
                                "page_number": page_count,
                                "total_records": total_records,
                            },
                        )

                    except Exception as checkpoint_error:
                        logger.warning(
                            "Failed to save checkpoint",
                            extra={
                                "operation": "data_extraction",
                                "job_id": job_id,
                                "error": str(checkpoint_error),
                            },
                        )

                # TODO: Handle pagination based on Hubspot_Deals API response
                if (
                    data.get("paging")
                    and data["paging"].get("next")
                    and data["paging"]["next"].get("after")
                ):
                    after = data["paging"]["next"]["after"]
                elif data.get("has_more"):
                    after = data.get("next_cursor")
                elif data.get("next_page_token"):
                    after = data.get("next_page_token")
                else:
                    # Final checkpoint on completion
                    if checkpoint_callback:
                        try:
                            final_checkpoint = {
                                "phase": "main_data_completed",
                                "records_processed": total_records,
                                "cursor": None,
                                "page_number": page_count,
                                "batch_size": 100,
                                "checkpoint_data": {
                                    "completion_status": "success",
                                    "total_pages": page_count,
                                    "final_total": total_records,
                                    "service": "hubspot_deals",
                                },
                            }
                            checkpoint_callback(job_id, final_checkpoint)
                        except Exception as e:
                            logger.warning(
                                "Failed to save final checkpoint",
                                extra={"job_id": job_id, "error": str(e)},
                            )

                    logger.info(
                        "Data extraction completed",
                        extra={
                            "operation": "data_extraction",
                            "job_id": job_id,
                            "total_records": total_records,
                            "total_pages": page_count,
                        },
                    )
                    break

            except Exception as e:
                logger.error(
                    "Error fetching data page",
                    extra={
                        "operation": "data_extraction",
                        "job_id": job_id,
                        "page_number": page_count + 1,
                        "error": str(e),
                    },
                    exc_info=True,
                )

                # Save error checkpoint for debugging
                if checkpoint_callback:
                    try:
                        error_checkpoint = {
                            "phase": "main_data_error",
                            "records_processed": total_records,
                            "cursor": after,
                            "page_number": page_count,
                            "batch_size": 100,
                            "checkpoint_data": {
                                "error": str(e),
                                "error_page": page_count + 1,
                                "recovery_cursor": after,
                                "service": "hubspot_deals",
                            },
                        }
                        checkpoint_callback(job_id, error_checkpoint)
                    except:
                        pass

                raise e

    return [get_main_data]