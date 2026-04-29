#!/usr/bin/env python3
"""Generate competitive intelligence using OpenAI API.

Queries trims from Supabase, groups by segment/body_style, picks ONE representative
trim per model (prefer Base/FWD), generates cross-brand comparisons via GPT-4o-mini,
and creates competitive_sets + selling_points records.

Usage: python3 scripts/generate-competitive-intel.py
"""

import json
import os
import re
import sys
import time
import logging
from collections import defaultdict
from urllib.request import Request, urlopen
from urllib.error import HTTPError

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# 2026-04-18 H-10: Use canonical SUPABASE_SERVICE_ROLE_KEY (matches the
# Next.js app). The legacy `SUPABASE_SERVICE_KEY` var is retired.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY or not OPENAI_API_KEY:
    logger.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY")
    sys.exit(1)


def get_existing_pairs():
    """Fetch all existing competitive_set trim pairs to skip duplicates."""
    rows = supabase_request("GET", "competitive_sets",
        query_params="select=vehicle_a_trim_id,vehicle_b_trim_id")
    pairs = set()
    for r in rows:
        pairs.add(tuple(sorted([r["vehicle_a_trim_id"], r["vehicle_b_trim_id"]])))
    return pairs


def supabase_request(method, table, data=None, query_params=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if query_params:
        url += f"?{query_params}"

    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=ignore-duplicates"
    }

    body = json.dumps(data).encode("utf-8") if data else None
    req = Request(url, data=body, headers=headers, method=method)

    try:
        with urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        error_msg = e.read().decode("utf-8")
        logger.error(f"Supabase error ({method} {table}): {e.code} {error_msg}")
        raise


def get_all_trims():
    query = "select=*,model_years(year,models(name,segment,body_style,makes(name)))"
    return supabase_request("GET", "trims", query_params=query)


def pick_representative_trims(trims):
    """Pick ONE representative trim per (make, model, year). Prefer Base/FWD trims."""
    by_model = defaultdict(list)
    for t in trims:
        my = t.get("model_years")
        if not my or not my.get("models") or not my["models"].get("makes"):
            continue
        model = my["models"]
        make = model["makes"]
        key = (make["name"], model["name"], my["year"])
        by_model[key].append(t)

    reps = []
    for key, group in by_model.items():
        # Prefer: Base, FWD, then first
        best = group[0]
        for t in group:
            name = t["name"].lower()
            if "base" in name or name == "fwd":
                best = t
                break
            if "fwd" in name or "2wd" in name:
                best = t
        reps.append(best)
    return reps


def group_by_segment(trims):
    groups = defaultdict(list)
    for t in trims:
        my = t["model_years"]
        model = my["models"]
        make = model["makes"]
        seg = model.get("segment", "unknown") or "unknown"
        bs = model.get("body_style", "unknown") or "unknown"
        groups[(seg, bs)].append({
            "trim_id": t["id"],
            "trim_name": t["name"],
            "make": make["name"],
            "model": model["name"],
            "year": my["year"],
            "engine": t.get("engine"),
            "drivetrain": t.get("drivetrain"),
            "fuel_type": t.get("fuel_type"),
            "mpg_city": t.get("mpg_city"),
            "mpg_highway": t.get("mpg_highway"),
            "mpg_combined": t.get("mpg_combined"),
            "annual_fuel_cost": t.get("annual_fuel_cost"),
            "transmission": t.get("transmission"),
        })
    return groups


def call_openai(prompt):
    """Call OpenAI with JSON mode enabled."""
    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "You are an automotive sales training content specialist. Return only valid JSON."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.5,
        "max_tokens": 1500,
        "response_format": {"type": "json_object"}
    }

    req = Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json"
        },
        method="POST"
    )

    with urlopen(req) as response:
        result = json.loads(response.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"]
        return json.loads(content)


def build_spec_string(v):
    """Build compact spec string for prompt."""
    parts = []
    if v.get("drivetrain"):
        parts.append(v["drivetrain"])
    if v.get("engine"):
        parts.append(v["engine"])
    if v.get("fuel_type") and v["fuel_type"] != "gasoline":
        parts.append(v["fuel_type"])
    if v.get("transmission"):
        parts.append(v["transmission"][:30])

    mpg_parts = []
    if v.get("mpg_city"):
        mpg_parts.append(f"{v['mpg_city']} city")
    if v.get("mpg_highway"):
        mpg_parts.append(f"{v['mpg_highway']} hwy")
    if v.get("mpg_combined"):
        mpg_parts.append(f"{v['mpg_combined']} combined")

    spec = " | ".join(parts)
    if mpg_parts:
        spec += f"\n  MPG: {' / '.join(mpg_parts)}"
    if v.get("annual_fuel_cost"):
        spec += f" | Annual fuel: ${v['annual_fuel_cost']}"
    return spec


def generate_comparison(a, b):
    """Generate competitive comparison between two vehicles."""
    prompt = f"""Compare these two vehicles for car salesperson training.

Vehicle A: {a['year']} {a['make']} {a['model']} {a['trim_name']}
  {build_spec_string(a)}

Vehicle B: {b['year']} {b['make']} {b['model']} {b['trim_name']}
  {build_spec_string(b)}

Return a JSON object:
{{
  "advantages_a": ["specific factual advantage of Vehicle A with numbers"],
  "advantages_b": ["specific factual advantage of Vehicle B with numbers"],
  "key_differentiators": ["2-3 most important differences a salesperson should know"],
  "selling_points_a": [
    {{
      "advantage": "specific selling point with numbers",
      "vs_competitor": "what Vehicle B offers instead",
      "objection_response": "conversational response when customer mentions Vehicle B",
      "category": "fuel_economy|safety|technology|value|space|performance"
    }}
  ],
  "selling_points_b": [
    {{
      "advantage": "specific selling point with numbers",
      "vs_competitor": "what Vehicle A offers instead",
      "objection_response": "conversational response when customer mentions Vehicle A",
      "category": "fuel_economy|safety|technology|value|space|performance"
    }}
  ]
}}

Rules:
- Use ONLY the spec data provided. Do not invent numbers.
- Every advantage must include a specific number or fact from the specs.
- Objection responses must be conversational, not robotic.
- If a spec is None/missing, skip that comparison.
- Generate 2-3 selling points per vehicle."""

    return call_openai(prompt)


def save_comparison(a, b, result):
    """Save competitive_set and selling_points to Supabase."""
    # Insert competitive set
    cs_data = [{
        "vehicle_a_trim_id": a["trim_id"],
        "vehicle_b_trim_id": b["trim_id"],
        "comparison_notes": json.dumps({
            "advantages_a": result.get("advantages_a", []),
            "advantages_b": result.get("advantages_b", []),
            "key_differentiators": result.get("key_differentiators", []),
        }),
        "generated_by": "llm",
    }]

    try:
        supabase_request("POST", "competitive_sets", cs_data)
    except Exception as e:
        logger.error(f"Failed to save competitive_set: {e}")
        return False

    # Insert selling points for vehicle A
    sp_rows = []
    for sp in result.get("selling_points_a", []):
        sp_rows.append({
            "trim_id": a["trim_id"],
            "advantage": sp.get("advantage", ""),
            "vs_competitor": sp.get("vs_competitor"),
            "objection_response": sp.get("objection_response"),
            "category": sp.get("category", "features"),
            "generated_by": "llm",
        })

    # Insert selling points for vehicle B
    for sp in result.get("selling_points_b", []):
        sp_rows.append({
            "trim_id": b["trim_id"],
            "advantage": sp.get("advantage", ""),
            "vs_competitor": sp.get("vs_competitor"),
            "objection_response": sp.get("objection_response"),
            "category": sp.get("category", "features"),
            "generated_by": "llm",
        })

    if sp_rows:
        try:
            supabase_request("POST", "selling_points", sp_rows)
        except Exception as e:
            logger.error(f"Failed to save selling_points: {e}")
            return False

    return True


def main():
    logger.info("Starting competitive intelligence generation")

    trims = get_all_trims()
    logger.info(f"Fetched {len(trims)} total trims")

    # Pick one representative trim per model/year
    reps = pick_representative_trims(trims)
    logger.info(f"Selected {len(reps)} representative trims")

    groups = group_by_segment(reps)
    logger.info(f"Grouped into {len(groups)} segment/body_style combinations")

    total = 0
    errors = 0
    existing_pairs = get_existing_pairs()
    logger.info(f"Found {len(existing_pairs)} existing competitive sets — will skip")
    seen_pairs = set(existing_pairs)

    for (segment, body_style), vehicles in groups.items():
        makes = set(v["make"] for v in vehicles)
        if len(makes) < 2:
            continue

        logger.info(f"Processing {segment}/{body_style}: {len(vehicles)} vehicles, {len(makes)} brands")

        # Generate cross-brand pairs (max 20 per segment to control costs)
        pairs_in_segment = 0
        for i, a in enumerate(vehicles):
            if pairs_in_segment >= 20:
                break
            for b in vehicles[i+1:]:
                if pairs_in_segment >= 20:
                    break
                if a["make"] == b["make"]:
                    continue

                pair_key = tuple(sorted([a["trim_id"], b["trim_id"]]))
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                try:
                    label = f"{a['year']} {a['make']} {a['model']} vs {b['year']} {b['make']} {b['model']}"
                    logger.info(f"Generating: {label}")

                    result = generate_comparison(a, b)
                    if save_comparison(a, b, result):
                        total += 1
                        pairs_in_segment += 1
                    else:
                        errors += 1

                    time.sleep(0.5)  # Rate limit courtesy

                except Exception as e:
                    logger.error(f"Error: {e}")
                    errors += 1

    logger.info(f"Complete: {total} competitive sets created, {errors} errors")


if __name__ == "__main__":
    main()
