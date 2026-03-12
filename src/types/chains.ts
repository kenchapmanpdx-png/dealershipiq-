// Phase 6C: Progressive Scenario Chain types

export interface ChainTemplate {
  id: string;
  name: string;
  description: string | null;
  totalSteps: number;
  stepPrompts: StepPrompt[];
  difficulty: 'easy' | 'medium' | 'hard';
  taxonomyDomains: string[];
  vehicleRequired: boolean;
}

export interface StepPrompt {
  step: number;
  base_prompt?: string;
  persona?: { mood: string; situation: string };
  branches?: Record<string, BranchTemplate>;
  branch_rules?: Record<string, string>;
}

export interface BranchTemplate {
  prompt: string;
  persona: { mood: string; situation: string };
}

export interface ChainContext {
  customer_name: string;
  vehicle: string;
  competitor_vehicle: string | null;
  stated_objections: string[];
  prior_responses_summary: string;
  emotional_state: string;
  branch_taken: string | null;
}

export interface StepResult {
  step: number;
  scores: Record<string, number>;
  feedback: string;
  completed_at: string;
}

export interface ScenarioChain {
  id: string;
  dealershipId: string;
  userId: string;
  chainTemplateId: string;
  currentStep: number;
  totalSteps: number;
  chainContext: ChainContext;
  stepResults: StepResult[];
  status: 'active' | 'completed' | 'abandoned' | 'expired';
  workDaysWithoutResponse: number;
  startedAt: string;
  lastStepAt: string | null;
}
