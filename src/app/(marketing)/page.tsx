// Landing page — light "Blue Tree" design system (2026-07-07 redesign).
// Server component; interactivity lives in MarketingFx (GSAP engine),
// MarketingNav, LeadForm, and PhoneMockup client components.

import { Metadata } from 'next';
import PhoneMockup from '@/components/marketing/PhoneMockup';
import MarketingFx from '@/components/marketing/MarketingFx';
import LeadForm from '@/components/marketing/LeadForm';
import KineticUnderline from '@/components/marketing/KineticUnderline';

export const metadata: Metadata = {
  title: 'SMS-Powered Sales Training for Auto Dealers | DealershipIQ',
  description:
    'Train your sales team via daily text messages. AI grades every response. Managers see real-time results. 30-day free trial, no credit card required.',
  alternates: {
    canonical: process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dealershipiq-wua7.vercel.app',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'DealershipIQ',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'SMS-based automotive sales training platform with AI grading and real-time manager dashboards.',
  offers: {
    '@type': 'Offer',
    price: '449',
    priceCurrency: 'USD',
    priceValidUntil: '2027-12-31',
    availability: 'https://schema.org/InStock',
  },
};

/* ── Data ── */

const metrics = [
  { start: '30', end: '5', prefix: '<', suffix: 's', display: '<5s', label: 'AI grading turnaround' },
  { start: '0', end: '100', prefix: '', suffix: '%', display: '100%', label: 'Works on every phone — no app needed' },
  { start: '0', end: '3', prefix: '', suffix: 'x', display: '3x', label: 'More practice reps than classroom' },
  { start: '9', end: '0', prefix: '', suffix: '', display: '0', label: 'Disruption to the sales floor' },
];

const testimonials = [
  {
    quote:
      'We went from sporadic whiteboard sessions to daily reps actually practicing objection handling. The AI feedback is better than what most trainers give.',
    name: 'Marcus T.',
    initials: 'MT',
    role: 'General Manager · Tri-County Ford',
  },
  {
    quote:
      "My guys are competitive. They started comparing scores in the group chat by day three. I haven't seen this level of engagement with any training tool.",
    name: 'Rachel K.',
    initials: 'RK',
    role: 'Sales Manager · Heritage Honda',
  },
  {
    quote:
      "I can finally see who's putting in the work and who's not — across all three stores. The coaching queue alone saves me 5 hours a week.",
    name: 'David L.',
    initials: 'DL',
    role: 'Dealer Principal · Lakeside Auto Group',
  },
];

const features = [
  {
    title: 'Daily SMS Training',
    description: 'Questions delivered by text. No app download, no login — reps just reply.',
    num: '01',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
  {
    title: 'AI-Powered Grading',
    description: 'Every answer scored in seconds, with feedback that tells each rep exactly what to fix.',
    num: '02',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
      </svg>
    ),
  },
  {
    title: 'Manager Dashboard',
    description: 'Real-time visibility into team performance, skill gaps, and coaching priorities.',
    num: '03',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    title: 'Adaptive Difficulty',
    description: 'Training adjusts to each rep — their strengths, weaknesses, and experience level.',
    num: '04',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
      </svg>
    ),
  },
  {
    title: 'Objection Roleplay',
    description:
      'Multi-exchange scenarios that simulate real customer pushback — price objections, competitor comparisons, and stalls. Reps build muscle memory for the moments that matter most.',
    num: '05',
    wide: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
      </svg>
    ),
  },
  {
    title: 'Multi-Rooftop',
    description: 'Unlimited reps at every store. One simple rate per rooftop — never per seat.',
    num: '06',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
];

const steps = [
  {
    num: '1',
    title: 'Enroll your team',
    description: 'Add salespeople by phone number. Takes 30 seconds per rep. No app to install.',
  },
  {
    num: '2',
    title: 'Training goes out daily',
    description: 'Each rep gets a scenario or question via text, tailored to their skill level.',
  },
  {
    num: '3',
    title: 'AI grades instantly',
    description: 'Responses scored on accuracy, technique, and professionalism. Feedback in seconds.',
  },
  {
    num: '4',
    title: 'Managers see everything',
    description: 'Live dashboard: scores, trends, skill gaps, and who needs coaching — across all stores.',
  },
];

const pricingFeatures = [
  'Unlimited salespeople',
  'Daily SMS training',
  'AI-powered grading & feedback',
  'Real-time manager dashboard',
  'Multi-exchange objection roleplay',
  'Coaching queue & priority alerts',
  'Custom scenario support',
  'Dedicated onboarding',
];

const faqItems = [
  {
    q: 'Do my salespeople need to download an app?',
    a: 'No. Training is delivered via standard SMS. If they can text, they can train. Works on every phone.',
  },
  {
    q: 'Do reps have to opt in?',
    a: 'Yes. Each rep confirms by text before training starts, and they can pause or stop anytime by replying. Opt-outs are honored automatically.',
  },
  {
    q: 'How long does each session take?',
    a: 'Most reps finish in 2-3 minutes. Designed to fit between customers — not replace floor time.',
  },
  {
    q: 'What topics does training cover?',
    a: 'Objection handling, trade-in conversations, F&I handoffs, competitive comparisons, customer psychology, and more. Content adapts to each rep automatically.',
  },
  {
    q: 'Can I add custom scenarios?',
    a: 'Yes. Managers can submit custom scenarios and competitive context specific to your market and inventory.',
  },
  {
    q: 'Is there a contract?',
    a: 'No long-term commitment. Month-to-month after your 30-day free trial. Cancel anytime.',
  },
];

export default function LandingPage() {
  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingFx />

      {/* ══════════ HERO ══════════ */}
      <section className="hero">
        <div className="hero-orb hero-orb-1" />
        <div className="hero-orb hero-orb-2" />
        <div className="hero-orb hero-orb-3" />
        <div className="hero-orb hero-orb-4" />
        <div className="hero-aurora" />
        <div className="container">
          <div className="hero-layout">
            <div>
              <div className="hero-eyebrow">
                <span className="pulse-dot" />
                SMS-Powered Sales Training
              </div>
              <h1>
                <span className="line">
                  <span className="line-inner">Turn reps into</span>
                </span>
                <span className="line">
                  <span className="line-inner">
                    <span className="accent-word">closers</span>,
                  </span>
                </span>
                <span className="line">
                  <span className="line-inner">not order takers.</span>
                </span>
              </h1>
              <p className="hero-tagline">Two minutes a day, by text. No app. No classroom.</p>
              <p className="hero-sub">
                AI grades every response in seconds. Managers see real-time results across every
                rooftop — no disruption to the floor.
              </p>
              <div className="hero-cta">
                <a href="#signup" className="btn btn-green btn-lg magnetic">
                  Start Free Trial <span className="btn-arrow">→</span>
                </a>
                <a href="#how" className="btn btn-ghost btn-lg">
                  See How It Works
                </a>
              </div>
            </div>
            <div>
              <div className="phone-wrap">
                <PhoneMockup />
              </div>
            </div>
          </div>

          <div className="hero-promises">
            <div className="hero-promise">
              <div className="promise-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div className="promise-text">
                <strong>30-Day Free Trial</strong>
                <span>Full access for a month. No credit card, no contract — cancel anytime.</span>
              </div>
            </div>
            <div className="hero-promise">
              <div className="promise-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
                  <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <div className="promise-text">
                <strong>No App to Download</strong>
                <span>Training arrives by standard SMS. If your reps can text, they can train.</span>
              </div>
            </div>
            <div className="hero-promise">
              <div className="promise-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="promise-text">
                <strong>Live in 5 Minutes</strong>
                <span>Add reps by phone number and training goes out the same day.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ METRICS BAR ══════════ */}
      <section className="metrics-strip">
        <div className="container">
          <div className="metrics-grid">
            {metrics.map((m) => (
              <div key={m.label} className="metric sr">
                <div
                  className="m-num"
                  data-start={m.start}
                  data-end={m.end}
                  data-prefix={m.prefix}
                  data-suffix={m.suffix}
                >
                  {m.display}
                </div>
                <div className="m-label">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ SOCIAL PROOF ══════════ */}
      <section className="section">
        <div className="container">
          <div className="section-head sr">
            <div className="section-tag">From the Floor</div>
            <h2>
              Managers who switched <span className="em">aren&apos;t going back</span>
            </h2>
          </div>
          <div className="testi-grid">
            {testimonials.map((t) => (
              <div key={t.name} className="testi-card sr">
                <div className="testi-head">
                  <div className="testi-avatar">{t.initials}</div>
                  <div>
                    <div className="name">{t.name}</div>
                    <div className="role">{t.role}</div>
                  </div>
                </div>
                <div className="testi-bubble">{t.quote}</div>
                <div className="testi-meta">Text Message · Today 9:41 AM</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="gradient-divider" />

      {/* ══════════ FEATURES ══════════ */}
      <section className="section section-alt" id="features">
        <div className="container">
          <div className="section-head sr">
            <div className="section-tag">Capabilities</div>
            <h2>
              Your sales team is texting anyway.{' '}
              <span className="em">
                <KineticUnderline delay={1000} rootMargin="0px 0px -30% 0px">
                  Make it count.
                </KineticUnderline>
              </span>
            </h2>
            <p>
              Everything a dealership needs to build a daily training habit — delivered over the
              channel your reps already live on.
            </p>
          </div>
          <div className="opp-grid">
            {features.map((f) => (
              <div key={f.title} className={`opp-card sr${f.wide ? ' wide' : ''}`}>
                <span className="opp-num">{f.num}</span>
                <div className="opp-card-top">
                  <div className="opp-icon">{f.icon}</div>
                  <h3>{f.title}</h3>
                </div>
                <p>{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="gradient-divider" />

      {/* ══════════ HOW IT WORKS ══════════ */}
      <section className="section" id="how">
        <div className="container">
          <div className="section-head sr">
            <div className="section-tag">How It Works</div>
            <h2>
              Live in four steps. <span className="em">Results on day one.</span>
            </h2>
            <p>No software rollout, no training day, no disruption to the floor.</p>
          </div>
          <div className="steps-track" id="stepsTrack">
            {steps.map((s) => (
              <div key={s.num} className="step sr">
                <div className="step-num">{s.num}</div>
                <h3>{s.title}</h3>
                <p>{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ PRICING ══════════ */}
      <section className="section section-alt" id="pricing">
        <div className="container">
          <div className="section-head sr">
            <div className="section-tag">Pricing</div>
            <h2>
              One plan. Unlimited reps. <span className="em">No surprises.</span>
            </h2>
          </div>
          <div className="rev-section sr">
            <div className="rev-card">
              <div className="rev-grid">
                <div>
                  <div className="rev-tag">Simple Pricing</div>
                  <div className="rev-big">
                    $449<span className="permo">/mo</span>
                  </div>
                  <div className="rev-sub">per dealership location — unlimited salespeople</div>
                </div>
                <div className="rev-right">
                  <ul className="rev-list">
                    {pricingFeatures.map((item) => (
                      <li key={item}>
                        <span className="pip" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="rev-foot">
                <span className="note">
                  30-day free trial · No credit card required · Cancel anytime
                </span>
                <a href="#signup" className="btn btn-green magnetic">
                  Start Free Trial <span className="btn-arrow">→</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="gradient-divider" />

      {/* ══════════ FAQ ══════════ */}
      <section className="section" id="faq">
        <div className="container">
          <div className="section-head sr">
            <div className="section-tag">FAQ</div>
            <h2>
              Common <span className="em">questions</span>
            </h2>
          </div>
          <div className="faq-wrap sr">
            {faqItems.map((item) => (
              <div key={item.q} className="faq-item">
                <button className="faq-q" type="button">
                  {item.q}
                  <span className="arrow">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </button>
                <div className="faq-a">
                  <p>{item.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ CTA BAND ══════════ */}
      <section className="cta-band">
        <div className="container">
          <h2 className="sr">
            Your first training question can go out{' '}
            <span className="em">
              <KineticUnderline delay={700}>today.</KineticUnderline>
            </span>
          </h2>
          <p className="sr">
            Five minutes to set up. By tomorrow morning, you&apos;ll see exactly who&apos;s putting
            in the work.
          </p>
          <div className="sr">
            <a href="#signup" className="btn btn-green btn-lg magnetic">
              Start Your Free Trial <span className="btn-arrow">→</span>
            </a>
            <div className="cta-micro">No credit card · No contract · Cancel anytime</div>
          </div>
        </div>
      </section>

      {/* ══════════ SIGNUP / LEAD CAPTURE ══════════ */}
      <section className="contact-section" id="signup">
        <div className="container">
          <div className="contact-grid">
            <div className="contact-info sr">
              <h2>Start your 30-day free trial</h2>
              <p>
                Tell us about your dealership and we&apos;ll have your team training by text before
                the end of the day.
              </p>
              <div className="c-detail">
                <div className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <span>Setup takes less than 5 minutes</span>
              </div>
              <div className="c-detail">
                <div className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <span>Works on every phone — no app to install</span>
              </div>
              <div className="c-detail">
                <div className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span>Month-to-month — cancel anytime</span>
              </div>
            </div>
            <div className="form-card sr">
              <LeadForm />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ STICKY CTA BAR ══════════ */}
      <div className="sticky-cta" id="stickyCta">
        <div className="sticky-cta-inner">
          <div className="sticky-cta-text">
            Turn reps into <span>closers</span> — 2 minutes a day, by text
          </div>
          <a href="#signup" className="btn btn-green">
            Start Free Trial <span className="btn-arrow">→</span>
          </a>
        </div>
      </div>
    </div>
  );
}
