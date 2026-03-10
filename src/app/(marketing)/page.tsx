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

export default function LandingPage() {
  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            SMS-Powered Sales Training
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Daily training delivered via text message. AI grades responses. Managers see results
            on a real-time dashboard.
          </p>
          <Link
            href="/signup"
            className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 text-lg font-semibold"
          >
            Start Free Trial
          </Link>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Why DealershipIQ
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <h3 className="text-xl font-bold text-gray-900 mb-3">Daily SMS Training</h3>
              <p className="text-gray-600">
                Short training questions delivered via text message. Fits into any salesperson's
                workflow.
              </p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <h3 className="text-xl font-bold text-gray-900 mb-3">AI Grading</h3>
              <p className="text-gray-600">
                OpenAI GPT-4 evaluates responses in real-time. Instant feedback to salespeople.
              </p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <h3 className="text-xl font-bold text-gray-900 mb-3">Manager Dashboard</h3>
              <p className="text-gray-600">
                Real-time insights into team performance, skill gaps, and coaching priorities.
              </p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <h3 className="text-xl font-bold text-gray-900 mb-3">Adaptive Learning</h3>
              <p className="text-gray-600">
                Training adjusts based on employee strengths, weaknesses, and availability.
              </p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <h3 className="text-xl font-bold text-gray-900 mb-3">Personalized Scenarios</h3>
              <p className="text-gray-600">
                Roleplay and quiz scenarios tailored to customer mood and competitive context.
              </p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <h3 className="text-xl font-bold text-gray-900 mb-3">Scalable</h3>
              <p className="text-gray-600">
                Manage unlimited salespeople across multiple locations. Pay per location.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">Pricing</h2>
        <div className="max-w-md mx-auto bg-blue-50 border-2 border-blue-600 rounded-lg p-8">
          <h3 className="text-2xl font-bold text-gray-900 mb-2">$449/month</h3>
          <p className="text-gray-600 mb-6">per dealership location</p>
          <ul className="space-y-3 mb-8">
            <li className="flex items-center text-gray-700">
              <span className="text-blue-600 mr-2">✓</span> Unlimited salespeople
            </li>
            <li className="flex items-center text-gray-700">
              <span className="text-blue-600 mr-2">✓</span> Daily SMS training
            </li>
            <li className="flex items-center text-gray-700">
              <span className="text-blue-600 mr-2">✓</span> AI grading
            </li>
            <li className="flex items-center text-gray-700">
              <span className="text-blue-600 mr-2">✓</span> Manager dashboard
            </li>
            <li className="flex items-center text-gray-700">
              <span className="text-blue-600 mr-2">✓</span> Coaching tools
            </li>
          </ul>
          <Link
            href="/signup"
            className="block w-full text-center bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-semibold"
          >
            Start Free Trial
          </Link>
          <p className="text-sm text-gray-600 text-center mt-4">30-day free trial. No credit card required.</p>
        </div>
      </section>
    </div>
  );
}
