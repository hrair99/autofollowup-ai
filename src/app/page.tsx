import Link from "next/link";
import {
  Zap,
  MessageSquare,
  Bot,
  BarChart3,
  ArrowRight,
  CheckCircle2,
  Clock,
  TrendingUp,
  Shield,
  Facebook,
  Star,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-gray-100 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Zap className="h-7 w-7 text-brand-600" />
            <span className="text-lg font-bold text-gray-900">
              AutoFollowUp
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-8 text-sm text-gray-600">
            <a href="#features" className="hover:text-gray-900 transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-gray-900 transition-colors">
              How It Works
            </a>
            <a href="#pricing" className="hover:text-gray-900 transition-colors">
              Pricing
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors shadow-sm"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
        {/* Background gradient */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-50/60 via-white to-white" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[600px] w-[800px] rounded-full bg-brand-100/40 blur-3xl" />
        </div>

        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-sm font-medium text-brand-700">
            <Bot className="h-4 w-4" />
            AI-Powered Lead Follow-Up
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-6xl">
            Never lose a lead{" "}
            <span className="bg-gradient-to-r from-brand-600 to-blue-500 bg-clip-text text-transparent">
              again
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600 sm:text-xl">
            AutoFollowUp uses AI to respond to Facebook comments and messages,
            qualify leads, and follow up automatically — so you can focus on
            doing the work, not chasing enquiries.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="group flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700 transition-all hover:shadow-brand-600/40"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how-it-works"
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-8 py-3.5 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
            >
              See How It Works
            </a>
          </div>

          {/* Social proof */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-gray-500">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              No credit card required
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-brand-500" />
              Set up in 5 minutes
            </div>
            <div className="flex items-center gap-1.5">
              <Facebook className="h-4 w-4 text-blue-500" />
              Works with Facebook Pages
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-gray-100 bg-gray-50/50 py-12">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 px-6 sm:grid-cols-4">
          {[
            { value: "24/7", label: "Auto-replies" },
            { value: "<2s", label: "Response time" },
            { value: "85%", label: "Reply rate" },
            { value: "3x", label: "More bookings" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
              <p className="mt-1 text-sm text-gray-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Everything you need to convert leads on autopilot
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              From the first Facebook comment to a confirmed booking — AutoFollowUp handles the entire journey.
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<MessageSquare className="h-6 w-6" />}
              title="Smart Comment Replies"
              description="AI detects potential leads in your Facebook comments and automatically replies publicly and via DM to start the conversation."
            />
            <FeatureCard
              icon={<Bot className="h-6 w-6" />}
              title="AI Messenger Bot"
              description="Responds to Messenger enquiries instantly with your business knowledge — pricing, service areas, availability — and qualifies the lead."
            />
            <FeatureCard
              icon={<TrendingUp className="h-6 w-6" />}
              title="Smart Follow-Ups"
              description="Automatically follows up with leads who go quiet. Adjusts timing and tone based on lead score and engagement history."
            />
            <FeatureCard
              icon={<BarChart3 className="h-6 w-6" />}
              title="Lead Scoring"
              description="Every lead gets a 0-100 score based on intent, urgency, engagement, and qualification data. Focus on the hottest leads first."
            />
            <FeatureCard
              icon={<Shield className="h-6 w-6" />}
              title="Human Handoff"
              description="When the AI detects a tricky situation — complaints, complex jobs, angry customers — it pauses and alerts you to take over."
            />
            <FeatureCard
              icon={<Zap className="h-6 w-6" />}
              title="Booking Integration"
              description="Automatically sends your booking form link when the lead is ready. No more copy-pasting links or forgetting to follow up."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-gray-100 bg-gray-50/50 py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              How it works
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Three steps to automated lead follow-up.
            </p>
          </div>

          <div className="mt-16 space-y-12">
            <Step
              number="1"
              title="Connect your Facebook Page"
              description="Sign in with Facebook and select the pages you want AutoFollowUp to monitor. Takes less than a minute."
            />
            <Step
              number="2"
              title="Configure your business info"
              description="Tell the AI about your services, pricing, areas you cover, and your booking form link. It uses this to reply accurately on your behalf."
            />
            <Step
              number="3"
              title="Let the AI work"
              description="Comments get answered, messages get replied to, leads get qualified and followed up — all automatically. You just show up for the jobs."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Start free. Upgrade when you need more.
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            <PricingCard
              name="Free"
              price="$0"
              description="Get started with the basics"
              features={[
                "1 Facebook Page",
                "50 AI replies / month",
                "Lead inbox",
                "Manual follow-ups",
              ]}
              cta="Get Started"
              href="/signup"
            />
            <PricingCard
              name="Starter"
              price="$29"
              description="For growing businesses"
              features={[
                "3 Facebook Pages",
                "500 AI replies / month",
                "Smart follow-ups",
                "Lead scoring",
                "Human handoff alerts",
              ]}
              cta="Start Free Trial"
              href="/signup"
              featured
            />
            <PricingCard
              name="Pro"
              price="$79"
              description="For serious lead machines"
              features={[
                "Unlimited Pages",
                "Unlimited AI replies",
                "Priority support",
                "Custom AI instructions",
                "ROI reporting",
                "API access",
              ]}
              cta="Start Free Trial"
              href="/signup"
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100">
        <div className="mx-auto max-w-4xl px-6 py-20 sm:py-28 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Stop losing leads to slow replies
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-gray-600">
            Your competitors are replying in seconds. With AutoFollowUp, you will too.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700 transition-all"
          >
            Get Started Free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-900 py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <Zap className="h-6 w-6 text-brand-400" />
              <span className="text-base font-bold text-white">AutoFollowUp</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-400">
              <Link href="/login" className="hover:text-white transition-colors">
                Log in
              </Link>
              <Link href="/signup" className="hover:text-white transition-colors">
                Sign up
              </Link>
              <a href="#features" className="hover:text-white transition-colors">
                Features
              </a>
              <a href="#pricing" className="hover:text-white transition-colors">
                Pricing
              </a>
            </div>
          </div>
          <div className="mt-8 border-t border-gray-800 pt-8 text-center text-sm text-gray-500">
            &copy; {new Date().getFullYear()} AutoFollowUp AI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Sub-components ── */

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group rounded-2xl border border-gray-200 bg-white p-6 transition-all hover:border-brand-200 hover:shadow-lg hover:shadow-brand-50">
      <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-brand-50 p-3 text-brand-600 group-hover:bg-brand-100 transition-colors">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        {description}
      </p>
    </div>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-6">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white shadow-lg shadow-brand-600/25">
        {number}
      </div>
      <div>
        <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-base leading-relaxed text-gray-600">
          {description}
        </p>
      </div>
    </div>
  );
}

function PricingCard({
  name,
  price,
  description,
  features,
  cta,
  href,
  featured,
}: {
  name: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`relative rounded-2xl border p-8 ${
        featured
          ? "border-brand-600 bg-white shadow-xl shadow-brand-100 ring-1 ring-brand-600"
          : "border-gray-200 bg-white"
      }`}
    >
      {featured && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
            <Star className="h-3 w-3" />
            Most Popular
          </span>
        </div>
      )}
      <h3 className="text-lg font-semibold text-gray-900">{name}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
      <p className="mt-6">
        <span className="text-4xl font-bold text-gray-900">{price}</span>
        {price !== "$0" && (
          <span className="text-sm text-gray-500"> /month</span>
        )}
      </p>
      <Link
        href={href}
        className={`mt-6 block w-full rounded-lg py-2.5 text-center text-sm font-semibold transition-colors ${
          featured
            ? "bg-brand-600 text-white hover:bg-brand-700 shadow-sm"
            : "bg-gray-900 text-white hover:bg-gray-800"
        }`}
      >
        {cta}
      </Link>
      <ul className="mt-8 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm text-gray-600">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-500 mt-0.5" />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}
