#!/usr/bin/env python3
"""Seed vehicle data from fueleconomy.gov CSV into Supabase."""

import csv
import json
import os
import sys
import logging
from collections import defaultdict
from urllib.request import Request, urlopen
from urllib.error import HTTPError

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# 2026-04-18 H-10: Use canonical SUPABASE_SERVICE_ROLE_KEY (matches the
# Next.js app). The legacy `SUPABASE_SERVICE_KEY` var is retired to avoid
# pointing at the deprecated `hbhcwbqxiumfauidtnbz` project by mistake.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)
CSV_PATH = os.environ.get("VEHICLES_CSV", "/sessions/epic-ecstatic-mendel/vehicles.csv")

TARGET_MAKES = {"Honda", "Toyota", "Hyundai", "Kia"}
TARGET_YEARS = {2025, 2026}

MAKE_COUNTRIES = {
    "Honda": "Japan",
    "Toyota": "Japan",
    "Hyundai": "South Korea",
    "Kia": "South Korea",
}

BASE_MODELS = {
    "Honda": {"Accord", "Civic", "CR-V", "HR-V", "Odyssey", "Passport", "Pilot", "Ridgeline", "Prologue", "Prelude"},
    "Toyota": {"Camry", "Corolla", "RAV4", "Highlander", "Tacoma", "Tundra", "4Runner", "Sequoia", "Sienna", "GR86", "GR Corolla", "Supra", "Prius", "bZ4X", "Crown", "Grand Highlander", "Venza", "Land Cruiser"},
    "Hyundai": {"Elantra", "Sonata", "Tucson", "Santa Fe", "Kona", "Palisade", "Ioniq 5", "Ioniq 6", "Ioniq 9", "Venue", "Santa Cruz", "Nexo"},
    "Kia": {"Forte", "K5", "Sportage", "Telluride", "Soul", "Seltos", "Sorento", "Carnival", "EV6", "EV9", "Stinger", "Niro"},
}

VCLASS_MAPPING = {
    "Midsize Cars": ("sedan", "midsize"),
    "Large Cars": ("sedan", "large"),
    "Subcompact Cars": ("sedan", "subcompact"),
    "Compact Cars": ("sedan", "compact"),
    "Small Station Wagons": ("hatchback", "compact"),
    "Small Sport Utility Vehicle 2WD": ("suv", "compact"),
    "Small Sport Utility Vehicle 4WD": ("suv", "compact"),
    "Standard Sport Utility Vehicle 2WD": ("suv", "midsize"),
    "Standard Sport Utility Vehicle 4WD": ("suv", "midsize"),
    "Minivan 2WD": ("minivan", "midsize"),
    "Minivan 4WD": ("minivan", "midsize"),
    "Standard Pickup Trucks 2WD": ("truck", "full-size"),
    "Standard Pickup Trucks 4WD": ("truck", "full-size"),
    "Two Seaters": ("coupe", "sports"),
}

DRIVE_MAPPING = {
    "Front-Wheel Drive": "FWD",
    "Rear-Wheel Drive": "RWD",
    "All-Wheel Drive": "AWD",
    "4-Wheel or All-Wheel Drive": "4WD",
    "4-Wheel Drive": "4WD",
    "2-Wheel Drive": "FWD",
}

def extract_base_model(fueleconomy_model, make):
    """Extract base model name from fueleconomy.gov model string."""
    if make not in BASE_MODELS:
        return fueleconomy_model, "Base"

    models = BASE_MODELS[make]
    # Sort by length descending to match longest first (e.g., "Ioniq 5" before "Ioniq")
    for model in sorted(models, key=len, reverse=True):
        if fueleconomy_model.startswith(model):
            trim = fueleconomy_model[len(model):].strip()
            return model, trim if trim else "Base"

    return fueleconomy_model, "Base"

def map_vclass(vclass):
    """Map VClass to body_style and segment."""
    if vclass in VCLASS_MAPPING:
        return VCLASS_MAPPING[vclass]
    # Default fallback
    return ("sedan", "midsize")

def map_drive(drive):
    """Map drive to drivetrain."""
    return DRIVE_MAPPING.get(drive, "FWD")

def build_engine_string(displ, cylinders, fuel_type, eng_dscr, model):
    """Build engine description string."""
    if fuel_type == "electric":
        return "Electric Motor"

    engine = f"{displ}L {cylinders}cyl"
    is_hybrid = "Hybrid" in (eng_dscr or "") or "Hybrid" in (model or "")
    if is_hybrid and fuel_type != "hybrid" and fuel_type != "plug-in hybrid":
        engine += " Hybrid"

    return engine

def map_fuel_type(fuel_type1, eng_dscr, model):
    """Map fuelType1 to fuel_type."""
    if fuel_type1 == "Electricity":
        return "electric"
    if fuel_type1 == "Diesel":
        return "diesel"

    is_hybrid = "Hybrid" in (eng_dscr or "") or "Hybrid" in (model or "")
    if is_hybrid:
        return "plug-in hybrid" if "Plug-in" in (eng_dscr or "") else "hybrid"

    return "gasoline"

def supabase_request(method, table, data=None, on_conflict=None):
    """Make REST request to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    if on_conflict:
        headers["Prefer"] += f",resolution={on_conflict}"

    if method == "POST" and data:
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

def load_csv():
    """Load and filter vehicles from CSV."""
    vehicles = []
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                year = int(row.get("year", 0))
                make = row.get("make", "").strip()

                if year not in TARGET_YEARS or make not in TARGET_MAKES:
                    continue

                vehicles.append(row)
            except (ValueError, KeyError):
                continue

    logger.info(f"Loaded {len(vehicles)} vehicles from CSV")
    return vehicles

def parse_vehicle(row):
    """Parse a vehicle row into structured data."""
    make = row.get("make", "").strip()
    model_str = row.get("model", "").strip()
    year = int(row.get("year", 0))

    base_model, trim = extract_base_model(model_str, make)

    vclass = row.get("VClass", "")
    body_style, segment = map_vclass(vclass)

    drive = row.get("drive", "")
    drivetrain = map_drive(drive)

    fuel_type1 = row.get("fuelType1", "").strip()
    eng_dscr = row.get("eng_dscr", "").strip()
    fuel_type = map_fuel_type(fuel_type1, eng_dscr, model_str)

    displ = float(row.get("displ", 0) or 0)
    cylinders = int(row.get("cylinders", 0) or 0)
    engine = build_engine_string(displ, cylinders, fuel_type, eng_dscr, model_str)

    transmission = row.get("trany", "").strip()

    mpg_city = float(row.get("city08", 0) or 0)
    mpg_highway = float(row.get("highway08", 0) or 0)
    mpg_combined = float(row.get("comb08", 0) or 0)

    annual_fuel_cost = float(row.get("fuelCost08", 0) or 0)
    co2_tailpipe = float(row.get("co2TailpipeGpm", 0) or 0)

    return {
        "make": make,
        "base_model": base_model,
        "trim": trim,
        "year": year,
        "body_style": body_style,
        "segment": segment,
        "drivetrain": drivetrain,
        "fuel_type": fuel_type,
        "transmission": transmission,
        "engine": engine,
        "mpg_city": mpg_city,
        "mpg_highway": mpg_highway,
        "mpg_combined": mpg_combined,
        "annual_fuel_cost": annual_fuel_cost,
        "co2_tailpipe": co2_tailpipe,
    }

def deduplicate_vehicles(parsed):
    """Deduplicate by (make, base_model, year, trim). Keep primary fuel type."""
    grouped = defaultdict(list)
    fuel_priority = {"gasoline": 3, "hybrid": 2, "plug-in hybrid": 2, "electric": 1, "diesel": 1}

    for vehicle in parsed:
        key = (vehicle["make"], vehicle["base_model"], vehicle["year"], vehicle["trim"])
        grouped[key].append(vehicle)

    deduped = []
    for group in grouped.values():
        # Sort by fuel type priority
        group.sort(key=lambda v: fuel_priority.get(v["fuel_type"], 0), reverse=True)
        deduped.append(group[0])

    logger.info(f"Deduplicated {len(parsed)} vehicles to {len(deduped)}")
    return deduped

def upsert_makes(vehicles):
    """Upsert makes into Supabase."""
    makes = {v["make"] for v in vehicles}
    make_rows = [{"name": make, "country": MAKE_COUNTRIES.get(make, "USA")} for make in makes]

    try:
        result = supabase_request("POST", "makes", make_rows, on_conflict="merge-duplicates")
        logger.info(f"Upserted {len(result)} makes")
        return {m["name"]: m["id"] for m in result}
    except Exception as e:
        logger.error(f"Error upserting makes: {e}")
        raise

def upsert_models(vehicles, make_ids):
    """Upsert models into Supabase."""
    models_set = set()
    model_rows = []

    for v in vehicles:
        key = (v["make"], v["base_model"])
        if key not in models_set:
            models_set.add(key)
            model_rows.append({
                "make_id": make_ids[v["make"]],
                "name": v["base_model"],
                "body_style": v["body_style"],
                "segment": v["segment"],
            })

    try:
        result = supabase_request("POST", "models", model_rows, on_conflict="merge-duplicates")
        logger.info(f"Upserted {len(result)} models")
        return {(m["make_id"], m["name"]): m["id"] for m in result}
    except Exception as e:
        logger.error(f"Error upserting models: {e}")
        raise

def upsert_model_years(vehicles, model_ids):
    """Upsert model_years into Supabase."""
    model_years_set = set()
    model_years_rows = []

    for v in vehicles:
        key = (v["base_model"], v["year"])
        if key not in model_years_set:
            model_years_set.add(key)
            make_id = None
            for (mid, mname), mid_val in model_ids.items():
                if mname == v["base_model"]:
                    model_years_rows.append({
                        "model_id": mid_val,
                        "year": v["year"],
                        "is_current": True,
                    })
                    break

    try:
        result = supabase_request("POST", "model_years", model_years_rows, on_conflict="merge-duplicates")
        logger.info(f"Upserted {len(result)} model_years")
        return {(m["model_id"], m["year"]): m["id"] for m in result}
    except Exception as e:
        logger.error(f"Error upserting model_years: {e}")
        raise

def upsert_trims(vehicles, model_ids, model_year_ids):
    """Upsert trims into Supabase."""
    trim_rows = []

    for v in vehicles:
        model_id = None
        for (make_id, model_name), mid in model_ids.items():
            if model_name == v["base_model"]:
                model_id = mid
                break

        if not model_id:
            logger.warning(f"Could not find model_id for {v['base_model']}")
            continue

        model_year_id = None
        for (mid, year), myid in model_year_ids.items():
            if mid == model_id and year == v["year"]:
                model_year_id = myid
                break

        if not model_year_id:
            logger.warning(f"Could not find model_year_id for {v['base_model']} {v['year']}")
            continue

        trim_rows.append({
            "model_year_id": model_year_id,
            "name": v["trim"],
            "engine": v["engine"],
            "transmission": v["transmission"],
            "drivetrain": v["drivetrain"],
            "fuel_type": v["fuel_type"],
            "mpg_city": v["mpg_city"],
            "mpg_highway": v["mpg_highway"],
            "mpg_combined": v["mpg_combined"],
            "annual_fuel_cost": v["annual_fuel_cost"],
            "co2_tailpipe": v["co2_tailpipe"],
        })

    try:
        result = supabase_request("POST", "trims", trim_rows, on_conflict="merge-duplicates")
        logger.info(f"Upserted {len(result)} trims")
        return result
    except Exception as e:
        logger.error(f"Error upserting trims: {e}")
        raise

def main():
    logger.info("Starting vehicle data seed")

    # Load and filter
    raw_vehicles = load_csv()
    if not raw_vehicles:
        logger.error("No vehicles loaded from CSV")
        sys.exit(1)

    # Parse
    parsed = [parse_vehicle(row) for row in raw_vehicles]

    # Deduplicate
    vehicles = deduplicate_vehicles(parsed)

    # Upsert
    make_ids = upsert_makes(vehicles)
    model_ids = upsert_models(vehicles, make_ids)
    model_year_ids = upsert_model_years(vehicles, model_ids)
    trims = upsert_trims(vehicles, model_ids, model_year_ids)

    logger.info(f"Seed complete: {len(make_ids)} makes, {len(model_ids)} models, {len(model_year_ids)} model_years, {len(trims)} trims")

if __name__ == "__main__":
    main()
