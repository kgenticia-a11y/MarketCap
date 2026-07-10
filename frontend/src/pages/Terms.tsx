import { Link } from "react-router-dom";
import { CandlestickChart, ArrowLeft } from "lucide-react";

const EFFECTIVE_DATE = "June 26, 2026";

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
        <p className="text-muted text-sm mb-2">Effective date: {EFFECTIVE_DATE}</p>
        <p className="text-muted text-xs mb-8">
          These Terms are a binding contract. Sections 17 (Arbitration) and 18 (Class-Action
          Waiver) require you to resolve disputes individually and by binding arbitration, and to
          waive the right to a jury trial and to participate in class actions. You may opt out of
          arbitration within 30 days of first acceptance as described in Section 17(g).
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-muted">

          {/* ============================================================ */}
          {/* PART I — TERMS OF SERVICE                                     */}
          {/* ============================================================ */}
          <section>
            <h2 className="text-white font-bold text-lg mb-4 pb-2 border-b border-border">
              Part I — Terms of Service
            </h2>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">1. Acceptance, Eligibility & Changes</h2>
            <p>
              By creating an account, accessing, or otherwise using MarketCap (the "Service",
              "we", "us", or "our"), you ("you" or "User") agree to be bound by these Terms of
              Service and Privacy Policy (collectively, the "Terms"). If you do not agree, do not
              use the Service.
            </p>
            <p className="mt-2">
              <strong className="text-white">Eligibility.</strong> You represent and warrant that
              you are (a) at least 18 years old (or the age of legal majority in your jurisdiction,
              whichever is greater); (b) legally able to enter into a binding contract; (c) not
              located in, under the control of, or a national or resident of any country subject to
              U.S. embargo or designated as a "terrorist supporting" country, and not on any U.S.
              Government list of prohibited or restricted parties (including OFAC SDN); and (d) not
              previously suspended or removed from the Service.
            </p>
            <p className="mt-2">
              <strong className="text-white">No children.</strong> The Service is not directed to
              children under 13, and we do not knowingly collect personal information from anyone
              under 13. If you believe a child under 13 has provided us personal information,
              contact us via the Feedback page so we can delete it.
            </p>
            <p className="mt-2">
              <strong className="text-white">Changes.</strong> We may modify these Terms at any
              time. Material changes will be notified by in-app notice, email, or by updating the
              "Effective date" above. Your continued use after the Effective date constitutes
              acceptance. If you do not agree to changes, your sole remedy is to stop using the
              Service and delete your account.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">
              2. No Investment Advice; Not a Broker-Dealer or Investment Adviser
            </h2>
            <p>
              <strong className="text-white">MarketCap is an informational and educational tool only.</strong>{" "}
              MarketCap is not registered as an investment adviser under the Investment Advisers
              Act of 1940, as a broker-dealer under the Securities Exchange Act of 1934, as a
              commodity trading advisor or futures commission merchant under the Commodity Exchange
              Act, or in any analogous capacity under any state or foreign law. MarketCap is not a
              member of FINRA, SIPC, NFA, or any self-regulatory organization.
            </p>
            <p className="mt-2">
              Nothing on the Service constitutes, and nothing should be construed as: (a)
              investment, financial, tax, legal, accounting, or other professional advice; (b) a
              recommendation, offer, or solicitation to buy, sell, hold, or transact in any
              security, derivative, commodity, digital asset, or other financial instrument; (c) a
              suitability determination; or (d) an offer to manage assets.
            </p>
            <p className="mt-2">
              You acknowledge and agree:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong className="text-white">All tools are informational.</strong> The income
                estimator, portfolio analytics, portfolio health score, screener, watchlist,
                alerts, paper trading, AI earnings briefs, and any future analytical tool are
                mathematical models or summaries based on inputs you or third parties supply. They
                are not predictions, recommendations, or guarantees and may be incomplete or wrong.
              </li>
              <li>Past performance is not indicative of future results.</li>
              <li>
                Investing involves risk, including the possible loss of principal. You are solely
                responsible for your own investment, tax, and financial decisions and should
                consult licensed professionals before acting.
              </li>
              <li>
                No fiduciary, advisory, brokerage, agency, or similar relationship is created
                between you and MarketCap by your use of the Service.
              </li>
              <li>
                Hypothetical or simulated performance results (including paper trading) have
                inherent limitations. No representation is made that any account will or is likely
                to achieve results similar to those shown.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">3. Paper Trading</h2>
            <p>
              The Service includes a "paper trading" feature that simulates buying and selling
              securities using virtual cash. <strong className="text-white">No real orders are
              placed, no real securities are bought or sold, no real money is involved, and no
              trade is routed to any exchange, broker, or alternative trading system.</strong> The
              paper trading feature is provided for educational purposes only and is not a
              brokerage service, a discretionary or non-discretionary advisory service, or a
              regulated activity. Prices used for paper trades are delayed or estimated and may
              differ materially from real-time exchange prices.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">4. Market Data; Third-Party Sources</h2>
            <p>
              Market data, fundamentals, earnings dates, and similar content are
              sourced from third-party providers and public sources. Such data may be delayed (in
              many cases by 15 minutes or more), incomplete, inaccurate, or unavailable. We do not
              warrant the accuracy, completeness, timeliness, or fitness of any data displayed,
              and you should not rely on it as the sole basis for any decision. Third-party
              providers may have their own terms that apply to your use of their data; we do not
              redistribute data in violation of those terms and you agree not to do so either.
            </p>
            <p className="mt-2">
              References to third-party broker, custodian, or account names (e.g., "Robinhood",
              "Fidelity", "Roth IRA") exist solely so you can label your own holdings. We are not
              affiliated with, endorsed by, or sponsored by any such third party, and all
              trademarks remain the property of their respective owners.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">5. AI-Generated Content</h2>
            <p>
              The Service uses large language models, including Anthropic's Claude, to generate
              summaries such as pre-earnings briefs and similar analytical text ("AI Output"). You
              acknowledge:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                AI Output is generated probabilistically and{" "}
                <strong className="text-white">may be inaccurate, incomplete, outdated,
                misleading, or fabricated ("hallucinated")</strong>, even when presented with
                confidence.
              </li>
              <li>
                AI Output is not investment advice and must not be relied on as the basis for any
                financial decision. Always verify with primary sources.
              </li>
              <li>
                To generate AI Output, certain inputs (e.g., the ticker, public earnings data, and
                similar context) are transmitted to third-party model providers (currently
                Anthropic). We do not transmit your account credentials, portfolio cost basis, or
                position size for this purpose.
              </li>
              <li>
                We do not represent that AI Output is unique to you or original; similar output
                may be generated for other users.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">6. Accounts & Security</h2>
            <p>
              You are responsible for maintaining the confidentiality of your credentials and for
              all activity that occurs under your account. You agree to: (a) provide accurate
              information at registration; (b) use a strong, unique password; (c) keep your
              credentials secure; and (d) notify us immediately at the Feedback page if you
              suspect unauthorized access. We are not liable for any loss arising from unauthorized
              use of your account where we have not been negligent.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">7. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Use the Service for any unlawful purpose or in violation of any applicable law, including securities, export control, sanctions, and anti-money-laundering laws.</li>
              <li>Attempt to gain unauthorized access to any account, system, network, or data.</li>
              <li>Scrape, crawl, harvest, mirror, or use automated means to extract data from the Service except as expressly permitted by our published API rate limits, or to circumvent any rate-limiting, access-control, or security feature.</li>
              <li>Reverse-engineer, decompile, or attempt to derive the source code of any non-open-source component of the Service except to the extent expressly permitted by law.</li>
              <li>Interfere with or disrupt the Service, its infrastructure, or other users' access (including denial-of-service, malware, or excessive request volumes).</li>
              <li>Use the Service to provide investment advice, brokerage services, or similar services to others without your own independent regulatory authorization.</li>
              <li>Resell, sublicense, or commercially redistribute the Service or any data obtained through it.</li>
              <li>Impersonate any person or entity, or misrepresent your identity or affiliation.</li>
              <li>Submit content that is unlawful, defamatory, harassing, infringing, obscene, or that contains personal data of any third party without lawful basis.</li>
              <li>Use the Service to train, fine-tune, evaluate, or benchmark any machine-learning model without our prior written consent.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">8. User Content & Feedback</h2>
            <p>
              You may submit feedback, ratings, messages, suggestions, or other content through the
              Service ("User Content"). You retain ownership of your User Content, but you grant
              MarketCap a worldwide, non-exclusive, royalty-free, sublicensable, perpetual, and
              irrevocable license to host, store, reproduce, modify, create derivative works of,
              publicly display, publicly perform, distribute, and otherwise use your User Content
              in connection with operating, improving, and promoting the Service, in any media now
              known or later developed. You waive any moral rights in User Content to the extent
              permitted by law.
            </p>
            <p className="mt-2">
              You represent and warrant that you have all rights necessary to grant the foregoing
              license and that your User Content does not infringe any third-party right or
              applicable law. We may remove, refuse, or restrict any User Content at our sole
              discretion and without notice.
            </p>
            <p className="mt-2">
              <strong className="text-white">Suggestions.</strong> Any feedback, suggestion, or
              feature request you submit may be used by us without restriction or obligation to
              you (including compensation).
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">9. Copyright (DMCA)</h2>
            <p>
              We respect intellectual property rights. If you believe content on the Service
              infringes your copyright, send a notice under the Digital Millennium Copyright Act
              (17 U.S.C. § 512) via the Feedback page that includes: (i) your physical or
              electronic signature; (ii) identification of the copyrighted work; (iii)
              identification of the allegedly infringing material and its location; (iv) your
              contact information; (v) a statement of good-faith belief that the use is not
              authorized; and (vi) a statement, under penalty of perjury, that the information is
              accurate and that you are authorized to act. Knowingly material misrepresentations
              may subject you to liability under 17 U.S.C. § 512(f). We may terminate accounts of
              repeat infringers.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">10. Intellectual Property; Limited License</h2>
            <p>
              The Service, including its design, user interface, source code, branding, logos, and
              original content, is owned by MarketCap or its licensors and is protected by
              intellectual property laws. Subject to your compliance with these Terms, we grant
              you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license
              to access and use the Service for your personal, non-commercial use. All rights not
              expressly granted are reserved.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">11. Beta Features</h2>
            <p>
              Features labeled "beta", "experimental", "preview", or similar are provided "as is"
              and may be modified or discontinued at any time. They may have additional limits or
              defects and are not subject to any service-level commitments.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">12. Service Availability</h2>
            <p>
              We do not guarantee uninterrupted or error-free access. We may modify, suspend,
              throttle, or discontinue any part of the Service at any time, with or without
              notice. We are not liable for any downtime, latency, data loss, or unavailability,
              including delays or missed price alerts caused by upstream data feeds, scheduling
              systems, email delivery, network conditions, or third-party outages.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">13. Disclaimer of Warranties</h2>
            <p className="uppercase text-xs tracking-wide">
              The Service, all content, and all AI Output are provided "as is" and "as available"
              without warranties of any kind, whether express, implied, statutory, or otherwise.
              To the maximum extent permitted by law, MarketCap disclaims all warranties,
              including the implied warranties of merchantability, fitness for a particular
              purpose, title, non-infringement, accuracy, and any warranty arising from course of
              dealing or usage of trade. We do not warrant that the Service will meet your
              requirements, be uninterrupted, secure, error-free, or accurate, that defects will
              be corrected, or that the Service is free of viruses or other harmful components.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">14. Limitation of Liability</h2>
            <p className="uppercase text-xs tracking-wide">
              To the maximum extent permitted by law, in no event will MarketCap, its officers,
              directors, employees, contractors, affiliates, suppliers, or licensors be liable for
              any indirect, incidental, special, consequential, exemplary, or punitive damages, or
              for any loss of profits, revenue, goodwill, data, business opportunity, investment
              loss, trading loss, or cost of substitute goods or services, whether based in
              contract, tort (including negligence), strict liability, statute, or otherwise, and
              whether or not MarketCap has been advised of the possibility of such damages.
            </p>
            <p className="mt-2 uppercase text-xs tracking-wide">
              MarketCap's aggregate liability arising out of or relating to these Terms or the
              Service will not exceed the greater of (a) the amount you paid to MarketCap in the
              twelve (12) months immediately preceding the event giving rise to the claim, or (b)
              one hundred U.S. dollars (US $100).
            </p>
            <p className="mt-2">
              <strong className="text-white">Carve-outs.</strong> The exclusions and limits in
              Sections 13 and 14 do not apply to: (i) your indemnification obligations under
              Section 15; (ii) your breach of Section 7 (Acceptable Use), Section 10 (Intellectual
              Property), or Section 19 (Confidentiality if any); or (iii) liability that cannot be
              limited or excluded under applicable law (including, where applicable, gross
              negligence, willful misconduct, fraud, death or personal injury caused by
              negligence, or statutory consumer rights).
            </p>
            <p className="mt-2">
              <strong className="text-white">Basis of the bargain.</strong> You acknowledge that
              the disclaimers and limitations in these Terms reflect a reasonable allocation of
              risk, are an essential basis of the bargain, and would not be granted to you absent
              such allocation. Some jurisdictions do not allow the exclusion or limitation of
              certain damages; in such jurisdictions, our liability is limited to the maximum
              extent permitted by law.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">15. Indemnification</h2>
            <p>
              You will defend, indemnify, and hold harmless MarketCap and its officers, directors,
              employees, contractors, affiliates, suppliers, and licensors from and against any
              third-party claim, demand, loss, liability, damage, cost, or expense (including
              reasonable attorneys' fees) arising out of or related to: (a) your use or misuse of
              the Service; (b) your User Content; (c) your violation of these Terms or applicable
              law; (d) your violation of any third-party right; or (e) any investment, trading,
              tax, or financial decision you make. We may assume the exclusive defense and control
              of any matter subject to indemnification, in which case you will cooperate with our
              defense. You may not settle any matter without our prior written consent.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">16. Termination</h2>
            <p>
              We may suspend or terminate your account or access at any time, with or without
              notice and with or without cause, including if we believe you have violated these
              Terms or that your use poses risk to us, the Service, or other users. You may
              terminate at any time by using the account-deletion feature in Settings or by
              contacting us via Feedback. Sections that by their nature should survive termination
              (including Sections 2, 4, 5, 8 (license grant), 10, 13–20, and 23) will survive.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">17. Governing Law & Binding Arbitration</h2>
            <p>
              <strong className="text-white">(a) Governing law.</strong> These Terms are governed
              by the laws of the Commonwealth of Massachusetts, U.S.A., excluding its
              conflict-of-laws rules. The United Nations Convention on Contracts for the
              International Sale of Goods does not apply.
            </p>
            <p className="mt-2">
              <strong className="text-white">(b) Informal resolution first.</strong> Before
              initiating arbitration, you and MarketCap agree to attempt to resolve any dispute
              informally by sending a written notice of the dispute to the other party (to us, via
              the Feedback page, marked "Legal Notice — Dispute") describing the nature and basis
              of the claim and the relief sought. The parties will negotiate in good faith for at
              least 30 days before initiating arbitration. The statute of limitations and any
              filing-fee deadlines are tolled during this period.
            </p>
            <p className="mt-2">
              <strong className="text-white">(c) Agreement to arbitrate.</strong> Any dispute,
              claim, or controversy arising out of or relating to these Terms or the Service
              ("Dispute") that is not resolved informally will be resolved by{" "}
              <strong className="text-white">final and binding individual arbitration</strong>{" "}
              administered by JAMS under its Streamlined Arbitration Rules and Procedures (for
              claims under US $250,000) or its Comprehensive Arbitration Rules (for larger
              claims), as in effect at the time arbitration is initiated. The Federal Arbitration
              Act, 9 U.S.C. §§ 1 et seq., governs the interpretation and enforcement of this
              arbitration agreement.
            </p>
            <p className="mt-2">
              <strong className="text-white">(d) Arbitrator authority.</strong> The arbitrator has
              exclusive authority to resolve any Dispute, including any claim that all or any part
              of this arbitration agreement is void or voidable, except that a court (not the
              arbitrator) decides issues of arbitrability of class, collective, or representative
              actions and the validity of the class-action waiver in Section 18.
            </p>
            <p className="mt-2">
              <strong className="text-white">(e) Venue and procedure.</strong> Arbitration will be
              held in the U.S. county where you reside, or, at your election, conducted by
              telephone, video, or written submissions only. Judgment on the award may be entered
              in any court of competent jurisdiction.
            </p>
            <p className="mt-2">
              <strong className="text-white">(f) Mass-arbitration protocol.</strong> If 25 or more
              similar Disputes are filed against MarketCap by or with the coordinated assistance
              of the same or coordinated counsel, the parties agree the dispute resolution will
              proceed in batches under JAMS's mass-arbitration procedures (or successor protocol),
              with bellwether cases selected and applicable filing fees apportioned as JAMS
              directs. This Section 17(f) is severable; if held unenforceable, the affected
              Disputes will proceed in court under Section 17(h).
            </p>
            <p className="mt-2">
              <strong className="text-white">(g) 30-day opt-out.</strong> You may opt out of this
              arbitration agreement by sending written notice via the Feedback page (subject:
              "Arbitration Opt-Out") within 30 days of first accepting these Terms (or, for
              existing users, within 30 days of the Effective date above). Notice must include
              your name, the email associated with your account, and a clear statement that you
              wish to opt out. Opting out does not affect any other provision of these Terms.
            </p>
            <p className="mt-2">
              <strong className="text-white">(h) Exceptions; small-claims.</strong> Either party
              may bring an individual action in small-claims court if the claim qualifies, and
              either party may seek injunctive or other equitable relief in a court of competent
              jurisdiction to protect its intellectual property rights. Exclusive jurisdiction and
              venue for such court proceedings (and for any proceeding not subject to arbitration)
              lies in the state and federal courts located in Suffolk County, Massachusetts, and
              the parties consent to personal jurisdiction therein.
            </p>
            <p className="mt-2">
              <strong className="text-white">(i) One-year limitations.</strong> Any Dispute must
              be filed within ONE (1) YEAR after the cause of action arose; otherwise it is
              permanently barred. This shorter period applies to the maximum extent permitted by
              law.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">18. Class-Action & Jury-Trial Waiver</h2>
            <p className="uppercase text-xs tracking-wide">
              You and MarketCap agree that each may bring claims against the other only on an
              individual basis and not as a plaintiff or class member in any purported class,
              collective, consolidated, private-attorney-general, or representative proceeding.
              The arbitrator may not consolidate more than one person's claims or preside over any
              representative or class proceeding. You and MarketCap each waive any right to a jury
              trial. If this Section 18 is held unenforceable as to any particular claim or
              remedy, that claim or remedy (and only that claim or remedy) will be severed and
              brought in court under Section 17(h), and the remainder of arbitration will proceed.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">19. Electronic Communications & E-Sign</h2>
            <p>
              You consent to receive communications from us in electronic form (email, in-app
              notice, or by posting on the Service) and you agree that all agreements, notices,
              disclosures, and other communications we provide electronically satisfy any legal
              requirement that they be in writing. This consent is given under the U.S. Electronic
              Signatures in Global and National Commerce Act (E-SIGN, 15 U.S.C. §§ 7001 et seq.).
              You may withdraw consent by deleting your account; you cannot use the Service
              without electronic communications.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">20. General</h2>
            <p>
              <strong className="text-white">Entire agreement.</strong> These Terms (with any
              policies referenced herein) are the entire agreement between you and MarketCap
              regarding the Service and supersede all prior agreements.
            </p>
            <p className="mt-2">
              <strong className="text-white">Severability.</strong> If any provision is held
              unenforceable, that provision will be modified to the minimum extent necessary, or
              severed, and the remainder will remain in effect.
            </p>
            <p className="mt-2">
              <strong className="text-white">No waiver.</strong> Our failure to enforce any right
              is not a waiver of that right.
            </p>
            <p className="mt-2">
              <strong className="text-white">Assignment.</strong> You may not assign or transfer
              these Terms without our prior written consent; any attempted assignment is void. We
              may freely assign these Terms, including in connection with a merger, acquisition,
              reorganization, or sale of assets.
            </p>
            <p className="mt-2">
              <strong className="text-white">Force majeure.</strong> We are not liable for any
              delay or failure due to causes beyond our reasonable control, including acts of God,
              war, terrorism, civil unrest, government action, labor disruption, pandemic,
              cyberattack, internet or power outage, or third-party service failure (including
              upstream data providers and AI model providers).
            </p>
            <p className="mt-2">
              <strong className="text-white">No third-party beneficiaries.</strong> There are no
              third-party beneficiaries to these Terms.
            </p>
            <p className="mt-2">
              <strong className="text-white">Relationship.</strong> Nothing in these Terms creates
              any partnership, joint venture, employment, fiduciary, or agency relationship.
            </p>
            <p className="mt-2">
              <strong className="text-white">Notices.</strong> Notices to you may be sent to the
              email on file or by in-app notice. Notices to us must be sent via the Feedback page
              with a subject beginning "Legal Notice —".
            </p>
            <p className="mt-2">
              <strong className="text-white">Headings.</strong> Headings are for convenience only
              and do not affect interpretation.
            </p>
          </section>

          {/* ============================================================ */}
          {/* PART II — PRIVACY POLICY                                      */}
          {/* ============================================================ */}
          <section className="pt-6">
            <h2 className="text-white font-bold text-lg mb-4 pb-2 border-b border-border">
              Part II — Privacy Policy
            </h2>
            <p>
              This Privacy Policy explains what personal information we collect, how we use and
              share it, and the choices and rights you have. It applies to your use of the
              Service.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">21. Information We Collect</h2>
            <p>We collect the following categories of personal information:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong className="text-white">Identifiers / account information:</strong> email
                address, display name, hashed password (passwords are stored using a
                cryptographically salted hashing algorithm and are not retrievable in plain text
                in the ordinary course), and the timestamp at which you accepted these Terms.
              </li>
              <li>
                <strong className="text-white">User-supplied financial inputs:</strong> tickers,
                share counts, cost basis, account labels (e.g., "Roth IRA"), watchlist entries,
                price-alert configurations, screener filters, paper-trading trades and balances,
                and portfolio snapshots derived from these inputs. These are{" "}
                <strong className="text-white">self-reported</strong> and do not connect to any
                real brokerage account.
              </li>
              <li>
                <strong className="text-white">User Content:</strong> ratings, categories, and
                messages you submit through Feedback.
              </li>
              <li>
                <strong className="text-white">Automatically collected data:</strong> IP address,
                approximate location derived from IP, browser type and version, device and
                operating system, request timestamps, referring URL, error logs, and other
                server-side log data necessary to operate, secure, and debug the Service.
              </li>
              <li>
                <strong className="text-white">Browser-local data:</strong> theme, chart settings,
                and similar preferences stored in your browser's localStorage. This data stays in
                your browser and is not transmitted to our servers unless required to render a
                feature.
              </li>
              <li>
                <strong className="text-white">Communications:</strong> the content of messages
                you send us and our responses.
              </li>
            </ul>
            <p className="mt-3">
              <strong className="text-white">We do not collect:</strong> Social Security numbers,
              government IDs, real brokerage credentials, bank account or routing numbers,
              payment-card numbers, biometric data, precise geolocation, or contents of any
              real-money account.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">22. How We Use Information</h2>
            <p>We use personal information to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>provide, maintain, secure, and improve the Service;</li>
              <li>authenticate users and prevent fraud, abuse, and unauthorized access;</li>
              <li>compute analytics and AI Output you request (including transmitting limited inputs to third-party model providers as described in Section 5);</li>
              <li>send transactional and security messages (price alerts you configure, account or security notices);</li>
              <li>respond to support requests and feedback;</li>
              <li>monitor performance, debug, and comply with our legal obligations;</li>
              <li>enforce these Terms and exercise or defend legal claims.</li>
            </ul>
            <p className="mt-2">
              <strong className="text-white">No advertising profiling.</strong> We do not use
              personal information to build advertising profiles, to deliver targeted ads, or for
              cross-context behavioral advertising. We do not engage in profiling that produces
              legal or similarly significant effects.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">23. Legal Bases (where applicable)</h2>
            <p>
              Where required by law, we rely on the following bases: (a) performance of our
              contract with you (operating the Service); (b) our legitimate interests (securing
              the Service, preventing abuse, improving the product); (c) compliance with legal
              obligations; and (d) your consent, where required (which you can withdraw at any
              time without affecting prior processing).
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">24. How We Share Information; Service Providers</h2>
            <p>
              We do not sell or rent personal information, and we do not "share" personal
              information for cross-context behavioral advertising as those terms are defined
              under the California Consumer Privacy Act / California Privacy Rights Act
              ("CCPA/CPRA"). We disclose information only as follows:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong className="text-white">Service providers / processors</strong> who help us
                operate the Service under written contracts that restrict use of personal
                information to providing services to us. Categories include: cloud hosting and
                database providers (e.g., Supabase, Fly.io, or successor providers); email
                delivery providers; error-monitoring providers; market-data providers (which
                receive ticker symbols and similar non-personal queries); and AI model providers
                (currently Anthropic, which receives limited inputs as described in Section 5).
              </li>
              <li>
                <strong className="text-white">Legal compliance and safety:</strong> when we
                reasonably believe disclosure is required by law, subpoena, court order, or other
                legal process, or necessary to protect the rights, property, or safety of
                MarketCap, our users, or the public.
              </li>
              <li>
                <strong className="text-white">Business transfers:</strong> in connection with a
                merger, acquisition, financing, reorganization, bankruptcy, or sale of all or part
                of our assets, subject to commercially reasonable confidentiality and continuation
                of this Privacy Policy.
              </li>
              <li>
                <strong className="text-white">With your direction:</strong> when you instruct us
                to share (e.g., exported data you choose to send elsewhere).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">25. Data Retention</h2>
            <p>
              We retain personal information only as long as reasonably necessary for the
              purposes for which it was collected:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Account and portfolio data: until you delete your account.</li>
              <li>Feedback and User Content: until you delete your account, after which it is anonymized (the user reference is set to NULL) and may be retained in anonymized form indefinitely for product analytics.</li>
              <li>Server logs containing IP and request metadata: typically up to 90 days, longer where needed for security investigation or legal hold.</li>
              <li>AI cache (e.g., earnings briefs): up to the earnings event date and a reasonable trailing period; cached AI Output is not user-specific.</li>
              <li>Backups: encrypted backups may retain data for up to 30 days after deletion before they are overwritten or expired.</li>
              <li>Records we are required to retain by law (e.g., tax, accounting, dispute records) for the period required by that law.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">26. Security & Breach Notification</h2>
            <p>
              We implement administrative, technical, and physical safeguards designed to protect
              personal information, including encryption in transit (TLS), encryption at rest
              where supported by our infrastructure providers, salted password hashing, access
              controls, and routine security review. <strong className="text-white">No method of
              transmission or storage is 100% secure</strong>; we cannot guarantee absolute
              security.
            </p>
            <p className="mt-2">
              If we become aware of a security incident that compromises the confidentiality,
              integrity, or availability of your personal information, we will notify affected
              users without unreasonable delay and otherwise as required by applicable law
              (including California Civil Code § 1798.82 and analogous state breach-notification
              statutes).
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">27. Your Choices (All Users)</h2>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong className="text-white">Export.</strong> Export your data at any time from
                the Settings page in a machine-readable format.
              </li>
              <li>
                <strong className="text-white">Delete.</strong> Delete your account at any time
                from the Settings page. Upon deletion, your account and personal data are removed
                from active systems and your Feedback is anonymized.
              </li>
              <li>
                <strong className="text-white">Update.</strong> Correct or update your information
                at any time from the Settings page.
              </li>
              <li>
                <strong className="text-white">Communications.</strong> You can stop receiving
                price alerts at any time by removing or disabling them. Account, security, and
                transactional messages are inherent to the Service; if you do not want them, do
                not use the Service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">28. California Privacy Rights (CCPA / CPRA)</h2>
            <p>
              If you are a California resident, the CCPA/CPRA provides you the following rights
              with respect to your personal information ("PI"):
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong className="text-white">Right to know</strong> the categories and specific pieces of PI we collect, sources, business purposes, and categories of recipients.</li>
              <li><strong className="text-white">Right to delete</strong> PI we have collected from you, subject to exceptions.</li>
              <li><strong className="text-white">Right to correct</strong> inaccurate PI.</li>
              <li><strong className="text-white">Right to portability</strong> of PI you provided.</li>
              <li><strong className="text-white">Right to opt out of sale or sharing</strong> of PI for cross-context behavioral advertising. <strong className="text-white">We do not sell or share PI</strong>, but you may exercise this right at any time.</li>
              <li><strong className="text-white">Right to limit use of sensitive PI.</strong> We do not collect or use sensitive PI for purposes beyond those permitted by the CPRA without limitation.</li>
              <li><strong className="text-white">Right to non-discrimination</strong> for exercising any of these rights.</li>
              <li><strong className="text-white">Right to designate an authorized agent</strong> to make a request on your behalf.</li>
              <li><strong className="text-white">Right to appeal</strong> our decision on your request.</li>
            </ul>
            <p className="mt-3">
              <strong className="text-white">Categories collected, sources, purposes, and disclosures (12-month look-back).</strong>{" "}
              We collect the categories of PI described in Section 21 ("identifiers", "customer
              records", "internet/network activity", "commercial information" limited to
              user-supplied tickers/holdings, "geolocation" limited to IP-derived approximate
              location). Sources are: you, your device/browser, and (for AI features) third-party
              model providers responding to our requests. Business purposes are described in
              Section 22. Categories of recipients are described in Section 24. We have{" "}
              <strong className="text-white">not sold or shared PI</strong> for cross-context
              behavioral advertising in the preceding 12 months and do not use or disclose
              sensitive PI for inferring characteristics.
            </p>
            <p className="mt-3">
              <strong className="text-white">How to exercise.</strong> Use the Settings page for
              export, deletion, and correction, or send a verifiable request via the Feedback
              page (subject: "California Privacy Request"). We will verify your request by
              matching the request to a logged-in session or by requesting additional information
              reasonably necessary to confirm identity. We will respond within 45 days (extendable
              by 45 days where permitted).
            </p>
            <p className="mt-3">
              <strong className="text-white">Shine the Light (Cal. Civ. Code § 1798.83).</strong>{" "}
              We do not disclose PI to third parties for their own direct-marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">29. Cookies & Local Storage</h2>
            <p>
              We use only the minimum cookies and browser-local storage necessary to operate the
              Service:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong className="text-white">Essential session cookies / tokens</strong> required to keep you signed in and to protect against CSRF and similar attacks.</li>
              <li><strong className="text-white">localStorage preferences</strong> (theme, chart settings) stored only in your browser.</li>
            </ul>
            <p className="mt-2">
              We do not use cookies or similar technologies for advertising, cross-site tracking,
              or third-party analytics. We do not honor or rely on the "Do Not Track" header
              because there is no industry consensus on it; however, we also do not track you
              across other sites.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">30. Email & Marketing Communications (CAN-SPAM)</h2>
            <p>
              We send transactional messages (price alerts you configure, account and security
              notices, and responses to your support requests) inherent to operating the Service.
              If we ever send promotional or marketing email, every such message will (a)
              accurately identify the sender, (b) contain a working unsubscribe mechanism, and
              (c) include our valid postal address, all as required by the U.S. CAN-SPAM Act, 15
              U.S.C. §§ 7701 et seq. Unsubscribing from marketing email does not stop
              transactional messages.
            </p>
            <p className="mt-2">
              <strong className="text-white">Our postal address:</strong> MarketCap, 16 Barrett
              Hill Drive, Amherst, MA 01002, U.S.A.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">31. International Users</h2>
            <p>
              The Service is operated from, and personal information is processed and stored in,
              the United States. By using the Service from outside the United States, you
              acknowledge that your information will be transferred to and processed in the United
              States, which may have data-protection laws different from those of your country.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">32. Changes to this Privacy Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Material changes will be
              notified by updating the "Effective date" above and, where appropriate, by in-app
              notice or email. Your continued use after the Effective date constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-3">33. Contact</h2>
            <p>
              For questions about these Terms or our privacy practices, including to exercise any
              privacy right described above, contact us via the Feedback page in the application.
              For formal legal notices, see Section 20.
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
