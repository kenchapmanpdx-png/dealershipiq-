import Link from 'next/link';
import { Metadata } from 'next';
import PhoneMockup from '@/components/marketing/PhoneMockup';
import AnimatedCounter from '@/components/marketing/AnimatedCounter';
import ScrollReveal from '@/components/marketing/ScrollReveal';
import { StaggerReveal } from '@/components/marketing/ScrollReveal';
import FAQ from '@/components/marketing/FAQ';

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

/* ── Data ── */

const features = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
    title: 'Daily SMS Training',
    description: 'Questions delivered by text. No app download, no login — reps just reply.',
    span: 'md:col-span-1',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
      </svg>
    ),
    title: 'AI-Powered Grading',
    description: 'GPT evaluates every response in real time. Instant, actionable feedback per rep.',
    span: 'md:col-span-1',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: 'Manager Dashboard',
    description: 'Real-time visibility into team performance, skill gaps, and coaching priorities.',
    span: 'md:col-span-1',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
      </svg>
    ),
    title: 'Adaptive Difficulty',
    description: 'Training adjusts to each rep — their strengths, weaknesses, and experience level.',
    span: 'md:col-span-1',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
      </svg>
    ),
    title: 'Objection Roleplay',
    description: 'Multi-exchange scenarios that simulate real customer pushback — price objections, competitor comparisons, and stalls. Reps build muscle memory for the moments that matter most.',
    span: 'md:col-span-2',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
      </svg>
    ),
    title: 'Multi-Rooftop',
    description: 'Unlimited reps across all your locations. One flat rate per dealership.',
    span: 'md:col-span-1',
  },
];

const steps = [
  {
    num: '01',
    title: 'Enroll your team',
    description: 'Add salespeople by phone number. Takes 30 seconds per rep. No app to install.',
  },
  {
    num: '02',
    title: 'Training goes out daily',
    description: 'Each rep gets a scenario or question via text, tailored to their skill level.',
  },
  {
    num: '03',
    title: 'AI grades instantly',
    description: 'Responses scored on accuracy, technique, and professionalism. Feedback in seconds.',
  },
  {
    num: '04',
    title: 'Managers see everything',
    description: 'Live dashboard: scores, trends, skill gaps, and who needs coaching — across all stores.',
  },
];

const metrics = [
  { value: '<5s', label: 'AI grading turnaround' },
  { value: '100%', label: 'SMS delivery — no app needed' },
  { value: '3x', label: 'More practice reps than classroom' },
  { value: '0', label: 'Disruption to the sales floor' },
];

const testimonials = [
  {
    quote: "We went from sporadic whiteboard sessions to daily reps actually practicing objection handling. The AI feedback is better than what most trainers give.",
    name: 'Marcus T.',
    role: 'General Manager',
    dealership: 'Tri-County Ford',
  },
  {
    quote: "My guys are competitive. They started comparing scores in the group chat by day three. I haven't seen this level of engagement with any training tool.",
    name: 'Rachel K.',
    role: 'Sales Manager',
    dealership: 'Heritage Honda',
  },
  {
    quote: "I can finally see who's putting in the work and who's not — across all three stores. The coaching queue alone saves me 5 hours a week.",
    name: 'David L.',
    role: 'Dealer Principal',
    dealership: 'Lakeside Auto Group',
  },
];

const faqItems = [
  {
    q: 'Do my salespeople need to download an app?',
    a: 'No. Training is delivered via standard SMS. If they can text, they can train. Works on every phone.',
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

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ══════════ HERO ══════════ */}
      <section className="relative py-20 md:py-28 lg:py-36 hero-gradient hero-grid overflow-hidden">
        {/* Ambient orbs — independent drift for depth */}
        <div className="orb orb-blue w-[700px] h-[700px] -top-56 -left-56 animate-orb-drift-1" />
        <div className="orb orb-purple w-[600px] h-[600px] top-10 right-[-18%] animate-orb-drift-2" />
        <div className="orb orb-cyan w-[400px] h-[400px] bottom-[-8%] left-[20%] animate-orb-drift-3" />
        <div
          className="orb orb-indigo w-[500px] h-[500px] top-[40%] left-[55%] animate-orb-drift-1"
          style={{ animationDelay: '-8s' }}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left — Copy */}
            <div className="hero-stagger">
              {/* Eyebrow */}
              <p className="inline-flex items-center gap-2 text-xs font-medium tracking-widest uppercase text-[var(--accent)] border border-[var(--accent)]/20 rounded-full px-4 py-1.5 mb-8 bg-[var(--accent)]/5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                SMS-Powered Sales Training
              </p>

              {/* Headline */}
              <h1 className="text-hero font-bold tracking-[-0.03em] text-white leading-[1.06] text-balance mb-6">
                Turn every rep into{' '}
                <span className="bg-gradient-to-r from-blue-400 via-blue-300 to-cyan-400 bg-clip-text text-transparent">
                  a closer
                </span>
              </h1>

              {/* Tagline */}
              <p className="text-xl sm:text-2xl font-semibold text-white/70 tracking-wide mb-6">
                Not another order taker.
              </p>

              {/* Subheadline */}
              <p className="text-body text-[var(--text-secondary)] max-w-lg mb-10 leading-relaxed">
                Daily training delivered by text message. AI grades every response in seconds.
                Managers see real-time results across every rooftop — no apps, no classroom time,
                no disruption to the floor.
              </p>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row items-start gap-4">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center bg-[var(--accent)] text-white font-semibold text-base px-8 py-4 rounded-lg hover:bg-[var(--accent-hover)] transition-all duration-300 ease-out-cubic shadow-glow animate-glow-pulse"
                >
                  Start Free Trial
                  <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                <Link
                  href="#how-it-works"
                  className="inline-flex items-center justify-center border border-[var(--border-card)] text-[var(--text-secondary)] font-medium text-base px-8 py-4 rounded-lg hover:border-[var(--border-hover)] hover:text-white transition-all duration-300 ease-out-cubic"
                >
                  See How It Works
                </Link>
              </div>

              {/* Trust signal */}
              <p className="text-xs text-[var(--text-muted)] mt-6 flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  30-day free trial
                </span>
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  No credit card
                </span>
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Live in 5 min
                </span>
              </p>
            </div>

            {/* Right — Phone mockup */}
            <div className="hero-stagger flex justify-center lg:justify-end">
              <PhoneMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ METRICS BAR ══════════ */}
      <section className="border-y border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 md:gap-12">
            {metrics.map((m) => (
              <AnimatedCounter key={m.label} value={m.value} label={m.label} />
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ SOCIAL PROOF ══════════ */}
      <section className="py-16 md:py-20 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal>
            <div className="text-center mb-16">
              <p className="text-xs font-medium tracking-widest uppercase text-[var(--accent)] mb-4">
                From the Floor
              </p>
              <h2 className="text-section font-bold tracking-[-0.02em] text-white text-balance">
                Managers who switched aren&apos;t going back
              </h2>
            </div>
          </ScrollReveal>

          <StaggerReveal className="grid grid-cols-1 md:grid-cols-3 gap-5" staggerMs={150}>
            {testimonials.map((t) => (
              <div
                key={t.name}
                className="glass rounded-2xl p-7 sm:p-8 flex flex-col card-hover"
              >
                <span className="quote-mark mb-2">&ldquo;</span>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed flex-1 mb-6 -mt-2">
                  {t.quote}
                </p>
                <div className="gradient-line mb-5" />
                <div>
                  <p className="text-sm font-semibold text-white">{t.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {t.role} · {t.dealership}
                  </p>
                </div>
              </div>
            ))}
          </StaggerReveal>
        </div>
      </section>

      {/* ══════════ FEATURES — BENTO GRID ══════════ */}
      <section id="features" className="py-16 md:py-20 lg:py-24 bg-[var(--bg-secondary)] scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal>
            <div className="max-w-2xl mb-16">
              <p className="text-xs font-medium tracking-widest uppercase text-[var(--accent)] mb-4">
                Capabilities
              </p>
              <h2 className="text-section font-bold tracking-[-0.02em] text-white text-balance">
                Everything your team needs to sell more cars
              </h2>
            </div>
          </ScrollReveal>

          <StaggerReveal className="grid grid-cols-1 md:grid-cols-3 gap-4" staggerMs={80}>
            {features.map((f) => (
              <div
                key={f.title}
                className={`glass card-hover rounded-2xl p-7 sm:p-8 group ${f.span}`}
              >
                <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)] mb-5 group-hover:bg-[var(--accent)]/15 transition-colors duration-300">
                  {f.icon}
                </div>
                <h3 className="text-card-title font-semibold text-white mb-2 tracking-tight">
                  {f.title}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {f.description}
                </p>
              </div>
            ))}
          </StaggerReveal>
        </div>
      </section>

      {/* ══════════ HOW IT WORKS ══════════ */}
      <section
        id="how-it-works"
        className="py-16 md:py-20 lg:py-24"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal>
            <div className="max-w-2xl mx-auto text-center mb-14">
              <p className="text-xs font-medium tracking-widest uppercase text-[var(--accent)] mb-4">
                How It Works
              </p>
              <h2 className="text-section font-bold tracking-[-0.02em] text-white text-balance">
                Live in four steps.<br />Results on day one.
              </h2>
            </div>
          </ScrollReveal>

          <StaggerReveal className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" staggerMs={120}>
            {steps.map((s, i) => (
              <div key={s.num} className="relative">
                {/* Connector line between steps on desktop */}
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-[calc(100%+8px)] w-[calc(100%-16px)] h-px bg-gradient-to-r from-[var(--accent)]/20 to-transparent" />
                )}
                <p className="step-number mb-4">{s.num}</p>
                <h3 className="text-lg font-semibold text-white mb-2 tracking-tight">
                  {s.title}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {s.description}
                </p>
              </div>
            ))}
          </StaggerReveal>
        </div>
      </section>

      {/* ══════════ PRICING ══════════ */}
      <section id="pricing" className="py-16 md:py-20 lg:py-24 bg-[var(--bg-secondary)] scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal>
            <div className="max-w-2xl mx-auto text-center mb-16">
              <p className="text-xs font-medium tracking-widest uppercase text-[var(--accent)] mb-4">
                Pricing
              </p>
              <h2 className="text-section font-bold tracking-[-0.02em] text-white text-balance">
                One plan. Unlimited reps.<br />No surprises.
              </h2>
            </div>
          </ScrollReveal>

          <ScrollReveal>
            <div className="max-w-lg mx-auto">
              <div className="gradient-border glass rounded-2xl p-8 sm:p-10">
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-5xl font-bold text-white tracking-tight">$449</span>
                  <span className="text-lg text-[var(--text-muted)]">/mo</span>
                </div>
                <p className="text-sm text-[var(--text-secondary)] mb-8">
                  per dealership location
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
                  {pricingFeatures.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-3 text-sm text-[var(--text-secondary)]"
                    >
                      <svg
                        className="w-4 h-4 flex-shrink-0 text-emerald-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {item}
                    </div>
                  ))}
                </div>

                <Link
                  href="/signup"
                  className="block w-full text-center bg-[var(--accent)] text-white font-semibold py-4 rounded-lg hover:bg-[var(--accent-hover)] transition-all duration-300 ease-out-cubic shadow-glow text-base"
                >
                  Start Free Trial
                </Link>
                <p className="text-xs text-[var(--text-muted)] text-center mt-4">
                  30-day free trial · No credit card required · Cancel anytime
                </p>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ══════════ FAQ ══════════ */}
      <section className="py-16 md:py-20 lg:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal>
            <div className="text-center mb-12">
              <p className="text-xs font-medium tracking-widest uppercase text-[var(--accent)] mb-4">
                FAQ
              </p>
              <h2 className="text-section font-bold tracking-[-0.02em] text-white">
                Common questions
              </h2>
            </div>
          </ScrollReveal>

          <ScrollReveal>
            <FAQ items={faqItems} />
          </ScrollReveal>
        </div>
      </section>

      {/* ══════════ FINAL CTA ══════════ */}
      <section className="relative py-16 md:py-20 lg:py-24 overflow-hidden">
        <div className="orb orb-blue w-[700px] h-[700px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-orb-drift-2" />
        <div className="orb orb-purple w-[450px] h-[450px] bottom-0 right-[10%] animate-orb-drift-3" />

        <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <ScrollReveal>
            <h2 className="text-section font-bold tracking-[-0.02em] text-white text-balance mb-6">
              Your sales team is texting anyway. Make it count.
            </h2>
            <p className="text-body text-[var(--text-secondary)] mb-10 leading-relaxed max-w-lg mx-auto">
              Start training today. See who&apos;s putting in the work on the dashboard by tomorrow morning.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center bg-[var(--accent)] text-white font-semibold text-lg px-10 py-5 rounded-lg hover:bg-[var(--accent-hover)] transition-all duration-300 ease-out-cubic shadow-glow animate-glow-pulse"
            >
              Start Your Free Trial
              <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <p className="text-xs text-[var(--text-muted)] mt-5">
              Setup takes less than 5 minutes · No credit card · No contract
            </p>
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
}
