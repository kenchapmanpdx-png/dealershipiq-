// Vehicle Data Types for Training Intelligence
// Global reference tables for vehicle specs, features, competitive sets.

export interface Make {
  id: string;
  name: string;
  country: string; // 'USA', 'Japan', 'Germany', etc.
}

export interface Model {
  id: string;
  make_id: string;
  name: string;
  body_type: string; // 'sedan', 'suv', 'truck', 'coupe', etc.
  years: number[];
}

export interface Trim {
  id: string;
  model_id: string;
  name: string;
  year: number;
  msrp: number; // USD
}

export interface TrimFeature {
  id: string;
  trim_id: string;
  category: string; // 'engine', 'interior', 'safety', 'tech', etc.
  name: string; // 'V6 Engine', 'Leather Seats', 'Apple CarPlay', etc.
  value: string; // '3.5L', 'Perforated', 'Yes', etc.
}

export interface SellingPoint {
  id: string;
  model_id: string;
  category: string; // 'reliability', 'performance', 'value', 'design', etc.
  point: string; // 'Industry-leading safety ratings', 'Exceptional fuel economy', etc.
  source: string; // 'NHTSA', 'EPA', 'consumer_research', 'marketing', etc.
}

export interface CompetitiveSet {
  id: string;
  model_id: string;
  competitor_model_id: string;
  comparison_notes: string; // How they compare: features, price range, market positioning
}

// Response types for vehicle queries
export interface VehicleProfile {
  model: Model & { make: Make };
  trims: (Trim & { features: TrimFeature[] })[];
  sellingPoints: SellingPoint[];
  competitiveSet: (CompetitiveSet & { competitor: Model & { make: Make } })[];
}
