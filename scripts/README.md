# Vehicle Data Pipeline Scripts

Four Python scripts for seeding and managing vehicle competitive intelligence data.

## 1. seed-vehicle-data.py

Seeds vehicle data from fueleconomy.gov CSV into Supabase.

**Usage:**
```bash
python3 scripts/seed-vehicle-data.py
```

**Environment variables:**
- `SUPABASE_URL`: Supabase project URL (default: https://nnelylyialhnyytfeoom.supabase.co)
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (matches Next.js app var)
- `VEHICLES_CSV`: Path to vehicles.csv (default: /sessions/epic-ecstatic-mendel/vehicles.csv)

**Logic:**
- Filters to years 2025-2026 and makes Honda, Toyota, Hyundai, Kia
- Extracts base model names from fueleconomy.gov "model" strings
- Maps VClass to body_style and segment
- Deduplicates by (make, base_model, year, trim), keeping primary fuel type
- Upserts makes, models, model_years, and trims via Supabase REST API

**Output:**
Logs total counts of created records (makes, models, model_years, trims).

---

## 2. generate-competitive-intel.py

Generates competitive intelligence using OpenAI GPT-4o-mini.

**Usage:**
```bash
python3 scripts/generate-competitive-intel.py
```

**Environment variables:**
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key
- `OPENAI_API_KEY`: OpenAI API key (default: embedded)

**Logic:**
- Fetches all trims with model/make context from Supabase
- Groups trims by segment and body_style
- For each cross-brand pair within a segment, calls OpenAI to generate comparison
- Parses response and inserts competitive_sets and selling_points rows
- Marks records with generated_by='llm' and reviewed_at=NULL

**Output:**
Logs count of competitive sets created.

---

## 3. export-vehicle-intel.py

Exports competitive_sets and selling_points to CSV for Ken's review.

**Usage:**
```bash
python3 scripts/export-vehicle-intel.py
```

**Environment variables:**
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key
- `OUTPUT_PATH`: Output CSV file path (default: ./vehicle-intel-export.csv)

**Output columns:**
id, primary_vehicle, competitor_vehicle, advantage, vs_competitor, objection_response, category, generated_by, reviewed_at

---

## 4. import-vehicle-intel.py

Imports reviewed CSV back into database. Updates selling_points rows that were edited.

**Usage:**
```bash
python3 scripts/import-vehicle-intel.py
```

**Environment variables:**
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key
- `INPUT_PATH`: Input CSV file path (default: ./vehicle-intel-export.csv)

**Logic:**
- Loads reviewed CSV
- For each row, compares with original database record
- If any content field changed (advantage, vs_competitor, objection_response, category):
  - Updates selling_point with new values
  - Sets generated_by='llm_reviewed'
  - Sets reviewed_at to current timestamp
- Skips unchanged rows

**Output:**
Logs count of updated and unchanged rows.

---

## Workflow

1. **Seed data:**
   ```bash
   python3 scripts/seed-vehicle-data.py
   ```

2. **Generate competitive intelligence:**
   ```bash
   python3 scripts/generate-competitive-intel.py
   ```

3. **Export for review:**
   ```bash
   python3 scripts/export-vehicle-intel.py
   ```

4. **Ken reviews CSV and makes edits locally**

5. **Import reviewed data:**
   ```bash
   python3 scripts/import-vehicle-intel.py
   ```
