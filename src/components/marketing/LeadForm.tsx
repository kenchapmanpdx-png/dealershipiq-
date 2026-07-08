'use client';

// Lead-capture form for the landing page. POSTs to /api/leads which stores
// the lead in marketing_leads (Supabase). Includes a honeypot field
// ("company") that the API uses to silently drop bots.

import { useState } from 'react';

type Status = 'idle' | 'sending' | 'done' | 'error';

export default function LeadForm() {
  const [status, setStatus] = useState<Status>('idle');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === 'sending') return;

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    setStatus('sending');
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Lead submit failed (${res.status})`);
      form.reset();
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };

  const note =
    status === 'done' ? (
      <span className="note ok">
        Got it — we&apos;ll reach out shortly to get your team set up.
      </span>
    ) : status === 'error' ? (
      <span className="note err">
        Something went wrong — please try again in a minute.
      </span>
    ) : (
      <span className="note">No credit card required.</span>
    );

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-2col">
        <div className="fg">
          <label htmlFor="lf-first">First Name</label>
          <input id="lf-first" name="first" type="text" placeholder="Jane" required />
        </div>
        <div className="fg">
          <label htmlFor="lf-last">Last Name</label>
          <input id="lf-last" name="last" type="text" placeholder="Smith" required />
        </div>
        <div className="fg">
          <label htmlFor="lf-email">Work Email</label>
          <input
            id="lf-email"
            name="email"
            type="email"
            placeholder="jane@yourdealership.com"
            required
          />
        </div>
        <div className="fg">
          <label htmlFor="lf-phone">Phone</label>
          <input id="lf-phone" name="phone" type="tel" placeholder="(555) 123-4567" />
        </div>
        <div className="fg span">
          <label htmlFor="lf-dealership">Dealership Name</label>
          <input
            id="lf-dealership"
            name="dealership"
            type="text"
            placeholder="Your dealership name"
            required
          />
        </div>
        <div className="fg">
          <label htmlFor="lf-size">Number of Salespeople</label>
          <select id="lf-size" name="size" defaultValue="">
            <option value="">Select range</option>
            <option>1–10</option>
            <option>11–25</option>
            <option>26–50</option>
            <option>51+</option>
          </select>
        </div>
        <div className="fg">
          <label htmlFor="lf-role">Your Role</label>
          <select id="lf-role" name="role" defaultValue="">
            <option value="">Select</option>
            <option>General Manager</option>
            <option>Sales Manager</option>
            <option>Dealer Principal / Owner</option>
            <option>Internet / BDC Manager</option>
            <option>Other</option>
          </select>
        </div>
        <div className="fg span">
          <label htmlFor="lf-notes">Anything else?</label>
          <textarea
            id="lf-notes"
            name="notes"
            placeholder="Optional — locations, brands, or questions"
          />
        </div>
        {/* Honeypot — hidden from humans, bots fill it, API drops it */}
        <div className="fg fg-hp" aria-hidden="true">
          <label htmlFor="lf-company">Company</label>
          <input id="lf-company" name="company" type="text" tabIndex={-1} autoComplete="off" />
        </div>
      </div>
      <div className="form-foot">
        {note}
        <button type="submit" className="btn btn-green magnetic" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Start Free Trial'}{' '}
          <span className="btn-arrow">→</span>
        </button>
      </div>
    </form>
  );
}
