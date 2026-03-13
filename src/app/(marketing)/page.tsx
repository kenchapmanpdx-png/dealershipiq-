import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SMS-Powered Sales Training for Auto Dealers | DealershipIQ',
  description:
    'Train your sales team via daily text messages. AI grades every response. Managers see real-time results. 30-day free trial, no credit card required.',
  alternates: {
    canonical: 'https://dealershipiq-wua7.vercel.app',
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

/* ── Feature data ── */
const features = [
  {
    icon: '💬',
    title: 'Daily SMS Training',
    description:
      'Short training questions delivered via text. No app download, no login — just reply.',
    span: 'md:col-span-1',
  },
  {
    icon: '🤖',
    title: 'AI-Powered Grading',
    description:
      'GPT evaluates every response in real time. Instant, actionable feedback to each rep.',
    span: 'md:col-span-1',
  },
  {
    icon: '📊',
    title: 'Manager Dashboard',
    description:
      'Real-time visibility into team performance, skill gaps, and coaching priorities.',
    span: 'md:col-span-1',
  },
  {
    icon: '🎯',
    title: 'Adaptive Learning',
    description:
      'Training adjusts to each rep — their strengths, weaknesses, and schedule.',
    span: 'md:col-span-1',
  },
  {
    icon: '🎭',
    title: 'Objection Roleplay',
    description:
      'Multi-exchange scenarios that simulate real customer pushback. Reps practice handling price objections, competitor comparisons, and stalls.',
    span: 'md:col-span-2',
  },
  {
    icon: '📈',
    title: 'Scalable',
    description:
      'Unlimited reps across multiple rooftops. One flat rate per location.',
    span: 'md:col-span-1',
  },
];

const steps = [
  {
    num: '01',
    title: 'Enroll your team',
    description: 'Add salespeople by phone number. Takes 30 seconds per rep.',
  },
  {
    num: '02',
    title: 'Training goes out daily',
    description:
      'Each rep gets a text with a scenario or question tailored to their skill level.',
  },
  {
    num: '03',
    title: 'AI grades instantly',
    description:
      'Responses are scored on accuracy, professionalism, and sales technique.',
  },
  {
    num: '04',
    title: 'Managers see everything',
    description:
      'Live dashboard shows scores, trends, and who needs coaching — across all locations.',
  },
];

const metrics = [
  { value: '<5s', label: 'AI grading turnaround' },
  { value: '100%', label: 'SMS delivery — no app needed' },
  { value: '3x', label: 'More practice reps than classroom' },
  { value: '0', label: 'Disruption to the sales floor' },
];

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ══════════ HERO ══════════ */}
      <section className="relative py-24 md:py-32 lg:py-48">
        {/* Ambient orbs */}
        <div className="orb orb-blue w-[500px] h-[500px] -top-40 -left-40 animate-orb-float" />
        <div
          className="orb orb-purple w-[400px] h-[400px] top-20 right-[-10%] animate-orb-float"
          style={{ animationDelay: '-7s' }}
        />
        <div
          className="orb orb-cyan w-[300px] h-[300px] bottom-0 left-[30%] animate-orb-float"
          style={{ animationDelay: '-13s' }}
        />

        <div className="hero-stagger relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Eyebrow */}
          <p className="inline-block text-xs font-medium tracking-widest uppercase text-[var(--accent)] border border-[var(--accent)]/30 rounded-full px-4 py-1.5 mb-8">
            SMS-Powered Sales Training
          </p>

          {/* Headline */}
          <h1 className="text-hero font-bold tracking-tight text-white leading-[1.08] text-balance mb-6">
            Turn every rep into{' '}
            <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-cyan-400 bg-clip-text text-transparent">
              a closer
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-body text-[var(--text-secondary)] max-w-2xl mx-auto mb-10 leading-relaxed">
            Daily training delivered by text message. AI grades every response in seconds.
            Managers see real-time results across every rooftop — no apps, no classroom time,
            no disruption to the floor.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center bg-[var(--accent)] text-white font-semibold text-base px-7 py-3.5 rounded-lg hover:bg-[var(--accent-hover)] transition-all duration-300 ease-out-cubic shadow-glow animate-glow-pulse"
            >
              Start Free Trial
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center justify-center border border-[var(--border-card)] text-[var(--text-secondary)] font-medium text-base px-7 py-3.5 rounded-lg hover:border-[var(--border-hover)] hover:text-white transition-all duration-300 ease-out-cubic"
            >
              See How It Works
            </Link>
          </div>

          {/* Trust signal */}
          <p className="text-xs text-[var(--text-muted)] mt-6">
            30-day free trial · No credit card required · Setup in under 5 minutes
          </p>
        </div>
      </section>

      {/* ══════════ METRICS BAR ══════════ */}
      <section className="reveal border-y border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {metrics.map((m) => (
              <div key={m.label} className="text-center">
                <p className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-1">
                  {m.value}
                </p>
                <p className="text-sm text-[var(--text-muted)]">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ FEATURES — BENTO GRID ══════════ */}
      <section className="reveal py-24 md:py-32 lg:py-48">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-16">
            <p className="text-xs font-medium tracking-widest uppercase text-[var(--accent)] mb-4">
              Capabilities
            </p>
            <h2 className="text-section font-bold tracking-tight text-white text-balance">
              Everything your team needs to sell more cars
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {features.map((f) => (
              <div
                key={f.title}
                className={`glass card-hover rounded-2xl p-8 ${f.span}`}
              >
                <span className="text-2xl mb-4 block">{f.icon}</span>
                <h3 className="text-card-title font-semibold text-white mb-2 tracking-tight">
                  {f.title}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ HOW IT WORKS ══════════ */}
      <section
        id="how-it-works"
        className="reveal py-24 md:py-32 lg:py-48 bg-[var(--bg-secondary)]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center mb-16">
            <p className="text-xs font-medium tracking-widest uppercase text-[var(--accent)] mb-4">
              How It Works
            </p>
            <h2 className="text-section font-bold tracking-tight text-white text-balance">
              Live in four steps. Results on day one.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s) => (
              <div key={s.num} className="relative">
                <p className="text-5xl font-bold text-[var(--accent)]/10 mb-3 tracking-tighter">
                  {s.num}
                </p>
                <h3 className="text-lg font-semibold text-white mb-2 tracking-tight">
                  {s.title}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {s.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ PRICING ══════════ */}
      <section className="reveal py-24 md:py-32 lg:py-48">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center mb-16">
            <p className="text-xs font-medium tracking-widest uppercase text-[var(--accent)] mb-4">
              Pricing
            </p>
            <h2 className="text-section font-bold tracking-tight text-white text-balance">
              One plan. Unlimited reps. No surprises.
            </h2>
          </div>

          <div className="max-w-md mx-auto glass rounded-2xl p-10 border border-[var(--accent)]/20 shadow-glow">
            <p className="text-4xl font-bold text-white tracking-tight mb-1">
              $449<span className="text-lg font-normal text-[var(--text-muted)]">/mo</span>
            </p>
            <p className="text-sm text-[var(--text-secondary)] mb-8">
              per dealership location
            </p>
            <ul className="space-y-4 mb-10">
              {[
                'Unlimited salespeople',
                'Daily SMS training',
                'AI-powered grading',
                'Manager dashboard',
                'Multi-exchange roleplay',
                'Coaching tools',
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3 text-sm text-[var(--text-secondary)]"
                >
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/10 flex items-center justify-center">
                    <svg
                      className="w-3 h-3 text-[var(--accent)]"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="block w-full text-center bg-[var(--accent)] text-white font-semibold py-3.5 rounded-lg hover:bg-[var(--accent-hover)] transition-all duration-300 ease-out-cubic shadow-glow"
            >
              Start Free Trial
            </Link>
            <p className="text-xs text-[var(--text-muted)] text-center mt-4">
              30-day free trial · No credit card required
            </p>
          </div>
        </div>
      </section>

      {/* ══════════ FAQ ══════════ */}
      <section className="reveal py-24 md:py-32 lg:py-48 bg-[var(--bg-secondary)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-xs font-medium tracking-widest uppercase text-[var(--accent)] mb-4">
              FAQ
            </p>
            <h2 className="text-section font-bold tracking-tight text-white">
              Common questions
            </h2>
          </div>

          <div className="space-y-6">
            {[
              {
                q: 'Do my salespeople need to download an app?',
                a: 'No. Training is delivered via standard SMS. If they can text, they can train.',
              },
              {
                q: 'How long does each training session take?',
                a: 'Most reps finish in 2-3 minutes. Designed to fit between customers, not replace floor time.',
              },
              {
                q: 'What topics does training cover?',
                a: 'Objection handling, trade-in conversations, F&I handoffs, competitive comparisons, customer psychology, and more. Content adapts to each rep.',
              },
              {
                q: 'Can I customize scenarios for my dealership?',
                a: 'Yes. Managers can submit custom scenarios and competitive context that feed into the AI training engine.',
              },
              {
                q: 'Is there a contract?',
                a: 'No long-term commitment. Month-to-month after your 30-day free trial.',
              },
            ].map((faq) => (
              <div
                key={faq.q}
                className="glass rounded-xl p-6"
              >
                <h3 className="text-sm font-semibold text-white mb-2">
                  {faq.q}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ FINAL CTA ══════════ */}
      <section className="reveal relative py-24 md:py-32 lg:py-48 overflow-hidden">
        <div className="orb orb-blue w-[600px] h-[600px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-orb-float" />

        <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-section font-bold tracking-tight text-white text-balance mb-6">
            Your sales team is texting anyway. Make it count.
          </h2>
          <p className="text-body text-[var(--text-secondary)] mb-10 leading-relaxed">
            Start training today. See results on the dashboard by tomorrow morning.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center bg-[var(--accent)] text-white font-semibold text-base px-8 py-4 rounded-lg hover:bg-[var(--accent-hover)] transition-all duration-300 ease-out-cubic shadow-glow animate-glow-pulse"
          >
            Start Your Free Trial
          </Link>
        </div>
      </section>
    </div>
  );
}
