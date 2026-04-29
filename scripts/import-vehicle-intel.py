#!/usr/bin/env python3
"""Import reviewed vehicle intel CSV back into database."""

import csv
import os
import sys
import logging
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# 2026-04-18 H-10: Use canonical SUPABASE_SERVICE_ROLE_KEY (matches the
# Next.js app). The legacy `SUPABASE_SERVICE_KEY` var is retired.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

def supabase_request(method, table, data=None, filter_param=None):
    """Make REST request to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if filter_param:
        url += f"?{filter_param}"

    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    if method == "PATCH" and data:
        body = json.dumps(data).encode("utf-8")
    else:
        body = None

    req = Request(url, data=body, headers=headers, method=method)

    try:
        with urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        error_msg = e.read().decode("utf-8")
        logger.error(f"Supabase error ({method} {table}): {e.code} {error_msg}")
        raise

def load_csv(input_path):
    """Load and parse reviewed CSV."""
    rows = []
    with open(input_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows

def has_changed(original, reviewed):
    """Check if any content fields changed."""
    fields = ["advantage", "vs_competitor", "objection_response", "category"]
    for field in fields:
        if original.get(field, "") != reviewed.get(field, ""):
            return True
    return False

def import_from_csv(input_path):
    """Import reviewed selling points back into database."""
    logger.info(f"Loading CSV from {input_path}")
    rows = load_csv(input_path)
    logger.info(f"Loaded {len(rows)} rows")

    updated = 0
    unchanged = 0

    for row in rows:
        selling_point_id = row.get("id", "").strip()
        if not selling_point_id:
            logger.warning("Skipping row with missing id")
            continue

        # Fetch original selling point
        try:
            result = supabase_request("GET", "selling_points", filter_param=f"id=eq.{selling_point_id}")
            if not result:
                logger.warning(f"Selling point {selling_point_id} not found")
                continue

            original = result[0]
        except Exception as e:
            logger.error(f"Error fetching selling point {selling_point_id}: {e}")
            continue

        # Check if anything changed
        if not has_changed(original, row):
            unchanged += 1
            continue

        # Prepare update data
        update_data = {
            "advantage": row.get("advantage", ""),
            "vs_competitor": row.get("vs_competitor", ""),
            "objection_response": row.get("objection_response", ""),
            "category": row.get("category", ""),
            "generated_by": "llm_reviewed",
            "reviewed_at": datetime.utcnow().isoformat() + "Z"
        }

        # Update in database
        try:
            supabase_request("PATCH", "selling_points", update_data, filter_param=f"id=eq.{selling_point_id}")
            logger.info(f"Updated selling point {selling_point_id}")
            updated += 1
        except Exception as e:
            logger.error(f"Error updating selling point {selling_point_id}: {e}")
            continue

    logger.info(f"Import complete: {updated} updated, {unchanged} unchanged")
    return updated, unchanged

def main():
    input_path = os.environ.get("INPUT_PATH", "./vehicle-intel-export.csv")

    if not os.path.exists(input_path):
        logger.error(f"Input file not found: {input_path}")
        sys.exit(1)

    import_from_csv(input_path)

if __name__ == "__main__":
    main()
