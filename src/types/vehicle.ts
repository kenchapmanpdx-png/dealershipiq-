// Vehicle Data Types — Phase 4B Build Master Schema
// Global reference tables for vehicle specs, features, competitive sets, selling points.

export interface Make {
  id: string;
  name: string;
  country: string | null;
  logo_url: string | null;
}

export interface Model {
  id: string;
  make_id: string;
  name: string;
  body_style: string | null;
  segment: string | null;
}

export interface ModelYear {
  id: string;
  model_id: string;
  year: number;
  is_current: boolean;
}

export interface Trim {
  id: string;
  model_year_id: string;
  name: string;
  msrp: number | null;
  invoice: number | null;
  engine: string | null;
  hp: number | null;
  torque: number | null;
  transmission: string | null;
  drivetrain: string | null;
  fuel_type: string | null;
  mpg_city: number | null;
  mpg_highway: number | null;
  mpg_combined: number | null;
  cargo_cu_ft: number | null;
  seating_capacity: number | null;
  towing_lbs: number | null;
  curb_weight_lbs: number | null;
  annual_fuel_cost: number | null;
  co2_tailpipe: number | null;
}

export interface TrimFeature {
  id: string;
  trim_id: string;
  feature_name: string;
  feature_value: string | null;
  category: string | null;
}

export interface CompetitiveSet {
  id: string;
  vehicle_a_trim_id: string;
  vehicle_b_trim_id: string;
  comparison_notes: {
    advantages_a: string[];
    advantages_b: string[];
    key_differentiators: string[];
  };
  generated_by: 'llm' | 'manual' | 'llm_reviewed';
  reviewed_at: string | null;
}

export interface SellingPoint {
  id: string;
  trim_id: string;
  advantage: string;
  vs_competitor: string | null;
  objection_response: string | null;
  category: string | null;
  generated_by: 'llm' | 'manual' | 'llm_reviewed';
  reviewed_at: string | null;
}

export interface DealershipBrand {
  id: string;
  dealership_id: string;
  make_id: string;
  is_franchise: boolean;
  training_depth: 'deep' | 'basic';
}

// Composed types for queries
export interface TrimWithContext extends Trim {
  model_year: ModelYear;
  model: Model;
  make: Make;
}

export interface VehicleContext {
  primary: TrimWithContext | null;
  competitor: TrimWithContext | null;
  sellingPoints: SellingPoint[];
  competitiveNotes: CompetitiveSet | null;
}
