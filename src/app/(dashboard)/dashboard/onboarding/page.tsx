'use client';

// Phase 5: Post-checkout onboarding wizard
// Step 1: Select dealership brands
// Step 2: Import employees (reuse Phase 3 CSV import pattern)
// Step 3: Done — redirect to dashboard

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const BRAND_OPTIONS = [
  'Chevrolet', 'Ford', 'Toyota', 'Honda', 'Nissan', 'Hyundai', 'Kia',
  'Subaru', 'Mazda', 'Volkswagen', 'BMW', 'Mercedes-Benz', 'Audi',
  'Lexus', 'Acura', 'Infiniti', 'Volvo', 'Jeep', 'Ram', 'Dodge',
  'Chrysler', 'GMC', 'Buick', 'Cadillac', 'Lincoln', 'Genesis',
  'Mitsubishi', 'Porsche', 'Land Rover', 'Jaguar', 'Tesla', 'Rivian',
  'Lucid', 'CDJR', 'Other',
];

interface Employee {
  full_name: string;
  phone: string;
  role: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([
    { full_name: '', phone: '', role: 'employee' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check for session_id from Stripe redirect
  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    if (sessionId) {
      // Stripe checkout completed — we're in the right place
    }
  }, [searchParams]);

  const toggleBrand = (brand: string) => {
    setSelectedBrands((prev) =>
      prev.includes(brand)
        ? prev.filter((b) => b !== brand)
        : [...prev, brand]
    );
  };

  const saveBrands = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/onboarding/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: selectedBrands }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save brands');
        return;
      }
      setStep(2);
    } catch {
      setError('Failed to save brands');
    } finally {
      setLoading(false);
    }
  };

  const addEmployee = () => {
    setEmployees((prev) => [...prev, { full_name: '', phone: '', role: 'employee' }]);
  };

  const updateEmployee = (index: number, field: keyof Employee, value: string) => {
    setEmployees((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeEmployee = (index: number) => {
    setEmployees((prev) => prev.filter((_, i) => i !== index));
  };

  const saveEmployees = async () => {
    const validEmployees = employees.filter(
      (e) => e.full_name.trim() && e.phone.trim()
    );

    if (validEmployees.length === 0) {
      // Skip — they can add employees later
      router.push('/dashboard');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/onboarding/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employees: validEmployees }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to import employees');
        return;
      }
      setStep(3);
      setTimeout(() => router.push('/dashboard'), 2000);
    } catch {
      setError('Failed to import employees');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-2 flex-1 rounded-full ${
              s <= step ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {step === 1 && (
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Which brands does your dealership sell?
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            This helps us tailor training scenarios to your inventory.
          </p>

          <div className="flex flex-wrap gap-2 mb-6">
            {BRAND_OPTIONS.map((brand) => (
              <button
                key={brand}
                onClick={() => toggleBrand(brand)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  selectedBrands.includes(brand)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                }`}
              >
                {brand}
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={saveBrands}
              disabled={loading || selectedBrands.length === 0}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium"
            >
              {loading ? 'Saving...' : 'Continue'}
            </button>
            <button
              onClick={() => setStep(2)}
              className="text-gray-600 px-6 py-2 rounded-lg hover:bg-gray-100 font-medium"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Add your sales team
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Enter their name and mobile number. They&apos;ll receive daily training via text.
          </p>

          <div className="space-y-3 mb-6">
            {employees.map((emp, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <input
                  type="text"
                  placeholder="Full name"
                  value={emp.full_name}
                  onChange={(e) => updateEmployee(idx, 'full_name', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <input
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={emp.phone}
                  onChange={(e) => updateEmployee(idx, 'phone', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <select
                  value={emp.role}
                  onChange={(e) => updateEmployee(idx, 'role', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="employee">Rep</option>
                  <option value="manager">Manager</option>
                </select>
                {employees.length > 1 && (
                  <button
                    onClick={() => removeEmployee(idx)}
                    className="text-gray-400 hover:text-red-500 px-2 py-2"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addEmployee}
            className="text-blue-600 text-sm font-medium mb-6 block"
          >
            + Add another
          </button>

          <div className="flex gap-3">
            <button
              onClick={saveEmployees}
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium"
            >
              {loading ? 'Importing...' : 'Import Team'}
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="text-gray-600 px-6 py-2 rounded-lg hover:bg-gray-100 font-medium"
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-4">&#10003;</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            You&apos;re all set!
          </h2>
          <p className="text-gray-600">
            Redirecting to your dashboard...
          </p>
        </div>
      )}
    </div>
  );
}
