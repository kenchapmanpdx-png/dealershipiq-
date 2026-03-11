#!/usr/bin/env python3
"""Export competitive_sets and selling_points to CSV for review."""

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

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY")
    sys.exit(1)

def supabase_request(method, table, query_params=None):
    """Make REST request to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if query_params:
        url += f"?{query_params}"

    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    req = Request(url, headers=headers, method=method)

    try:
        with urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        error_msg = e.read().decode("utf-8")
        logger.error(f"Supabase error ({method} {table}): {e.code} {error_msg}")
        raise

def get_selling_points():
    """Fetch all selling points with competitive set context."""
    query = (
        "select=*,competitive_sets("
        "primary_trim_id,competitor_trim_id,"
        "primary:trims!primary_trim_id(name,model_years(year,models(name,makes(name)))),"
        "competitor:trims!competitor_trim_id(name,model_years(year,models(name,makes(name))))"
        ")"
    )
    result = supabase_request("GET", "selling_points", query_params=query)
    return result

def format_vehicle_name(trim_data, cs_data, field):
    """Format vehicle name from trim and competitive set data."""
    if field == "primary":
        trim_key = "primary"
    else:
        trim_key = "competitor"

    if trim_key not in cs_data or not cs_data[trim_key]:
        return "Unknown"

    trim = cs_data[trim_key]
    if not trim.get("model_years"):
        return "Unknown"

    my = trim["model_years"]
    if not my.get("models"):
        return "Unknown"

    model = my["models"]
    if not model.get("makes"):
        return "Unknown"

    make = model["makes"]
    return f"{my['year']} {make['name']} {model['name']} {trim['name']}"

def export_to_csv(output_path="./vehicle-intel-export.csv"):
    """Export selling points to CSV."""
    logger.info(f"Fetching selling points from Supabase")
    selling_points = get_selling_points()
    logger.info(f"Fetched {len(selling_points)} selling points")

    rows = []
    for sp in selling_points:
        cs = sp.get("competitive_sets", {})

        row = {
            "id": sp.get("id"),
            "primary_vehicle": format_vehicle_name(None, cs, "primary"),
            "competitor_vehicle": format_vehicle_name(None, cs, "competitor"),
            "advantage": sp.get("advantage", ""),
            "vs_competitor": sp.get("vs_competitor", ""),
            "objection_response": sp.get("objection_response", ""),
            "category": sp.get("category", ""),
            "generated_by": sp.get("generated_by", ""),
            "reviewed_at": sp.get("reviewed_at") or "",
        }
        rows.append(row)

    logger.info(f"Writing {len(rows)} rows to {output_path}")
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        fieldnames = [
            "id", "primary_vehicle", "competitor_vehicle",
            "advantage", "vs_competitor", "objection_response",
            "category", "generated_by", "reviewed_at"
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    logger.info(f"Export complete: {output_path}")
    return output_path

def main():
    output_path = os.environ.get("OUTPUT_PATH", "./vehicle-intel-export.csv")
    export_to_csv(output_path)

if __name__ == "__main__":
    main()
