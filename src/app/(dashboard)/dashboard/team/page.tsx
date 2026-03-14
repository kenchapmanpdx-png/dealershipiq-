// Team management page — list employees, add new, CSV import
// Client component — CRUD operations for team members
// Build Master: Phase 3

'use client';

import { useState, useEffect, useCallback } from 'react';

interface TeamMember {
  id: string;
  full_name: string;
  phone: string;
  status: string;
  total_sessions: number;
  average_score: number;
  last_training_at: string | null;
}

interface TeamData {
  team: TeamMember[];
}

export default function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMember, setNewMember] = useState({ name: '', phone: '' });
  const [adding, setAdding] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/team');
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch team:', (err as Error).message ?? err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMember.name.trim() || !newMember.phone.trim()) {
      alert('Please fill in all fields');
      return;
    }

    setAdding(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: newMember.name,
          phone: newMember.phone,
        }),
      });

      if (res.ok) {
        setNewMember({ name: '', phone: '' });
        setShowAddForm(false);
        await fetchData();
      } else {
        alert('Failed to add team member');
      }
    } catch (err) {
      console.error('Failed to add team member:', (err as Error).message ?? err);
      alert('Error adding team member');
    } finally {
      setAdding(false);
    }
  };

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/users/import', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        alert('Import successful');
        await fetchData();
      } else {
        alert('Import failed');
      }
    } catch (err) {
      console.error('Import error:', (err as Error).message ?? err);
      alert('Error importing CSV');
    }

    // Reset input
    e.target.value = '';
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-pulse">Loading team...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-gray-600">
        <p>Failed to load team</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Team Management</h1>
        <div className="flex gap-3">
          <label className="px-4 py-2 bg-gray-600 text-white rounded-md text-sm font-medium hover:bg-gray-700 cursor-pointer">
            Import CSV
            <input
              type="file"
              accept=".csv"
              onChange={handleCSVImport}
              className="hidden"
            />
          </label>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
          >
            {showAddForm ? 'Cancel' : 'Add Employee'}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <form
          onSubmit={handleAddMember}
          className="bg-white rounded-lg shadow p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={newMember.name}
              onChange={(e) =>
                setNewMember({ ...newMember, name: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              value={newMember.phone}
              onChange={(e) =>
                setNewMember({ ...newMember, phone: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="+1234567890"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {adding ? 'Adding...' : 'Add Employee'}
          </button>
        </form>
      )}

      {/* Team table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {data.team.length === 0 ? (
          <div className="p-6 text-center text-gray-600">
            <p>No team members yet</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Phone
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Sessions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Avg Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Last Active
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.team.map((member) => (
                <tr
                  key={member.id}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {member.full_name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {member.phone}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        member.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {member.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {member.total_sessions}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                    {member.average_score.toFixed(1)}/5
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {member.last_training_at
                      ? formatDate(member.last_training_at)
                      : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
