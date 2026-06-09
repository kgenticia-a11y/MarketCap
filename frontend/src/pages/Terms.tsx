import { Link } from "react-router-dom";
import { CandlestickChart, ArrowLeft } from "lucide-react";

const EFFECTIVE_DATE = "June 4, 2026";

export default function Terms() {
  return (
    <div className="min-h-screen bg-sidebar text-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-10">
          <Link to="/register" className="text-muted hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center">
            <CandlestickChart size={16} className="text-white" />
          </div>
          <span className="font-semibold text-lg">MarketCap</span>
        </div>

        <h1 className="text-2xl font-bold mb-2">Terms of Service & Privacy Policy</h1>
        <p className="text-muted text-sm mb-8">Effective date: {EFFECTIVE_DATE}</p>

        <div className="space-y-8 text-sm leading-relaxed text-muted">
          <section>
            <h2 className="text-white font-semibold text-base mb-3">1. Acceptance of Terms</h2>
            <p>
              By creating an account on MarketCap ("the Service"), you agree to be bound by these
              Terms of Service and our Privacy Policy. If you do not agree, do not use the Service.
              We reserve the right to update these terms at any time. Continued use after changes
              constitutes acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">2. No Investment Advice Disclaimer</h2>
            <p>
              MarketCap is an informational tool only. <strong className="text-white">The Service does not provide
              investment advice, financial advice, trading advice, or any other form of professional
              advice.</strong> All market data, charts, analytics, income estimations, portfolio tracking,
              and screener results displayed on this platform are provided solely for informational
              and educational purposes.
            </p>
            <p className="mt-2">
              You acknowledge and agree that:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>No content on this platform constitutes a recommendation to buy, sell, or hold any security, financial product, or instrument.</li>
              <li>Past performance of any security does not guarantee future results.</li>
              <li>The income estimator, portfolio analytics, and screener tools are mathematical projections, not predictions or guarantees of future returns.</li>
              <li>You are solely responsible for your own investment decisions and should consult a qualified financial advisor before making any investment.</li>
              <li>MarketCap, its creators, and affiliates shall not be held liable for any financial losses, damages, or consequences resulting from decisions made based on information displayed on this platform.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">3. Accuracy of Data</h2>
            <p>
              Market data is sourced from third-party providers and may be delayed, incomplete, or
              inaccurate. We do not guarantee the accuracy, completeness, or timeliness of any data
              displayed. Prices, statistics, and company information may differ from real-time
              exchange data. You should not rely on this data as the sole basis for any financial
              decision.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">4. User Accounts & Security</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials.
              You agree to use a strong, unique password and to notify us immediately of any
              unauthorized access to your account. We are not liable for losses caused by
              unauthorized use of your account.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">5. Privacy & Data Collection</h2>
            <p>We collect and store the following data:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong className="text-white">Account information:</strong> email address, display name, and hashed password (we never store your password in plain text).</li>
              <li><strong className="text-white">Portfolio data:</strong> tickers, share counts, and buy prices you enter for portfolio tracking.</li>
              <li><strong className="text-white">Watchlist & alerts:</strong> tickers you watch and price alert configurations.</li>
              <li><strong className="text-white">Feedback:</strong> ratings and messages you submit voluntarily.</li>
              <li><strong className="text-white">Usage data:</strong> theme preferences and chart settings stored locally in your browser (not on our servers).</li>
            </ul>
            <p className="mt-3">We do <strong className="text-white">not</strong>:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Sell, rent, or share your personal data with third parties for marketing purposes.</li>
              <li>Track your browsing activity across other websites.</li>
              <li>Use cookies for advertising or analytics beyond essential session management.</li>
              <li>Store any real brokerage credentials, bank account information, or payment details.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">6. Data Portability & Deletion</h2>
            <p>
              You may export all of your data at any time via the Settings page. You may also
              permanently delete your account and all associated data. Upon deletion, your personal
              data is removed and any feedback you submitted is anonymized. These rights are provided
              in compliance with applicable data protection regulations.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">7. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Use the Service for any unlawful purpose or to violate any applicable laws.</li>
              <li>Attempt to gain unauthorized access to the Service, other accounts, or our systems.</li>
              <li>Use automated tools to scrape, crawl, or extract data from the Service at excessive rates.</li>
              <li>Interfere with or disrupt the Service's infrastructure or other users' access.</li>
              <li>Impersonate another person or entity, or misrepresent your affiliation.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">8. Intellectual Property</h2>
            <p>
              The Service's design, source code, branding, and original content are the property of
              MarketCap. Market data displayed is provided by third-party sources and is subject to
              their respective terms. You may not reproduce, distribute, or create derivative works
              from the Service without prior written consent.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">9. Limitation of Liability</h2>
            <p>
              The Service is provided "as is" and "as available" without warranties of any kind,
              express or implied. To the maximum extent permitted by law, MarketCap shall not be
              liable for any indirect, incidental, special, consequential, or punitive damages,
              including but not limited to loss of profits, data, or goodwill, arising out of or
              in connection with your use of the Service.
            </p>
            <p className="mt-2">
              In no event shall our total liability exceed the amount you have paid to use the
              Service in the twelve (12) months preceding the claim, or $100 USD, whichever is less.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">10. Service Availability</h2>
            <p>
              We do not guarantee uninterrupted or error-free access to the Service. We may modify,
              suspend, or discontinue any part of the Service at any time without notice. We are not
              liable for any downtime or data unavailability.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">11. Third-Party Services</h2>
            <p>
              The Service relies on third-party data providers for market data. We are not
              responsible for the accuracy, availability, or policies of these providers. Links to
              external news articles or other third-party content do not imply endorsement.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">12. Termination</h2>
            <p>
              We reserve the right to suspend or terminate your account at our discretion if you
              violate these terms or engage in conduct that we determine is harmful to the Service
              or other users. You may terminate your account at any time by using the account
              deletion feature.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">13. Governing Law</h2>
            <p>
              These terms shall be governed by and construed in accordance with applicable laws.
              Any disputes shall be resolved through good-faith negotiation first, and if
              unresolved, through binding arbitration.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">14. Contact</h2>
            <p>
              If you have questions about these Terms or our privacy practices, please use the
              Feedback page within the application to contact us.
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-border text-xs text-muted">
          Last updated: {EFFECTIVE_DATE}
        </div>
      </div>
    </div>
  );
}
