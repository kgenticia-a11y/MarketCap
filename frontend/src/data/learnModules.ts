export interface QuizQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

export interface LearnModule {
  slug: string;
  title: string;
  subtitle: string;
  readMinutes: number;
  sections: { heading?: string; body: string }[];
  quiz: QuizQuestion[];
}

export const LEARN_MODULES: LearnModule[] = [
  {
    slug: "income-statement",
    title: "Reading an Income Statement",
    subtitle: "Understand the P&L from revenue to net income in 5 minutes.",
    readMinutes: 5,
    sections: [
      {
        heading: "What it tells you",
        body: "The income statement (also called the P&L — profit and loss) shows how much revenue a company generated over a period and what was left after every expense. Unlike the balance sheet (a snapshot of what a company owns and owes) or the cash flow statement (actual cash movement), the income statement follows accrual accounting: revenue is recorded when earned, expenses when incurred, regardless of when cash changes hands.",
      },
      {
        heading: "The four key lines",
        body: "Revenue (or 'Net sales') sits at the top — the total amount billed to customers. Subtract the cost of goods sold (COGS) — direct production costs — and you get Gross Profit. Gross margin (gross profit ÷ revenue) tells you how efficiently the company produces its product; software companies often run 70%+, retailers 25–40%. \n\nNext come operating expenses (R&D, marketing, G&A). Subtract those from gross profit and you reach Operating Income (EBIT). This is the truest measure of business operations — it's before financing decisions (interest) and tax strategy distort the picture. \n\nFinally, subtract interest expense and taxes to arrive at Net Income — the 'bottom line' that belongs to shareholders.",
      },
      {
        heading: "What to look for as an investor",
        body: "Margin trends matter more than the raw numbers. A company whose gross margin is expanding while operating margin is compressing is spending aggressively on growth — that can be rational or a red flag depending on the business. Watch for revenue growth that slows without a corresponding improvement in margins: it may signal the company is losing pricing power. Also watch for non-recurring items (restructuring charges, impairments) that inflate GAAP losses — strip these out when comparing year over year.",
      },
      {
        heading: "The accrual trap",
        body: "Because accrual accounting can be gamed — revenue recognised early, expenses deferred — always cross-check the income statement against the cash flow statement. If net income is rising but operating cash flow is flat or falling, earnings quality is deteriorating. Sustainable earnings are those that convert to cash.",
      },
    ],
    quiz: [
      {
        question: "A company has $1B in revenue and $600M in COGS. What is its gross margin?",
        choices: ["40%", "60%", "33%", "150%"],
        correctIndex: 0,
        explanation: "Gross profit = $1B − $600M = $400M. Gross margin = $400M ÷ $1B = 40%.",
      },
      {
        question: "Which income statement line is considered the best measure of pure operating efficiency, before financing and taxes?",
        choices: ["Net income", "Revenue", "Operating income (EBIT)", "Gross profit"],
        correctIndex: 2,
        explanation: "Operating income excludes interest and taxes, which depend on capital structure and tax strategy — not the underlying business. It's the cleanest line for comparing operational performance across companies.",
      },
      {
        question: "A company reports rising net income but falling operating cash flow. What should this signal to an investor?",
        choices: [
          "The company is growing rapidly",
          "Earnings quality may be deteriorating",
          "The balance sheet is strengthening",
          "The company has low debt",
        ],
        correctIndex: 1,
        explanation: "When net income and operating cash flow diverge, it often means accrual-based earnings are outrunning actual cash collection — a classic sign of deteriorating earnings quality.",
      },
    ],
  },

  {
    slug: "valuation-multiples",
    title: "P/E and Valuation Multiples",
    subtitle: "How investors price a business — and when the multiples lie.",
    readMinutes: 6,
    sections: [
      {
        heading: "Why multiples exist",
        body: "A multiple compresses a complex valuation into a single ratio so you can quickly compare two companies. Instead of building a full DCF for every stock, investors ask: 'How much am I paying per dollar of earnings?' or 'How much per dollar of revenue?' The most common multiples are P/E, EV/EBITDA, and P/S (price-to-sales). Each answers a different question and each has blind spots.",
      },
      {
        heading: "Price-to-Earnings (P/E)",
        body: "P/E = share price ÷ earnings per share (EPS). A P/E of 25 means you're paying $25 for every $1 of annual profit. High P/E stocks are priced for growth — the market expects earnings to rise sharply. Low P/E stocks are either cheap or value traps. \n\nThe key question is always: compared to what? P/E only makes sense relative to the company's own history, its peers, or the market average. A P/E of 40 is cheap for a company growing earnings 50% per year (the PEG ratio — P/E ÷ growth rate — captures this). The same P/E is expensive for a company shrinking.",
      },
      {
        heading: "EV/EBITDA",
        body: "Enterprise value (EV = market cap + debt − cash) represents what it would actually cost to buy the whole business and assume its liabilities. EBITDA (earnings before interest, taxes, depreciation, amortisation) is a rough proxy for operating cash flow. EV/EBITDA is better than P/E for comparing companies with different capital structures (debt levels) or depreciation policies. It's the go-to multiple in M&A.",
      },
      {
        heading: "Price-to-Sales (P/S)",
        body: "P/S is used when a company has no earnings — common for high-growth tech. It's the loosest multiple because revenue carries no information about profitability. A P/S of 10 on a company with 80% gross margins might be reasonable; on a company with 20% gross margins it's almost certainly too high. Always consider the path to profitability when using P/S.",
      },
      {
        heading: "When multiples mislead",
        body: "GAAP earnings can be distorted by accounting choices, one-time items, and stock-based compensation. Many analysts prefer 'adjusted EPS' — but be suspicious if management's adjustments consistently run above GAAP earnings. Multiples also break down for cyclical companies (high P/E at a trough, low P/E at a peak, both misleading). Use multiples as a starting point, not a conclusion.",
      },
    ],
    quiz: [
      {
        question: "A stock trades at $100 with EPS of $4. A competitor trades at $60 with EPS of $3. Which has the higher P/E?",
        choices: [
          "The $100 stock (P/E 25)",
          "The $60 stock (P/E 20)",
          "They are equal",
          "Cannot be determined without revenue",
        ],
        correctIndex: 0,
        explanation: "P/E = price ÷ EPS. Stock A: 100÷4 = 25. Stock B: 60÷3 = 20. Stock A has the higher P/E.",
      },
      {
        question: "Why do analysts often prefer EV/EBITDA over P/E when comparing companies in capital-intensive industries?",
        choices: [
          "EV/EBITDA is always lower",
          "It accounts for differences in debt levels and depreciation policies",
          "It uses revenue instead of earnings",
          "P/E is not available for public companies",
        ],
        correctIndex: 1,
        explanation: "EV includes debt, so companies with different capital structures are on a level playing field. Adding back depreciation removes the effect of different asset write-off schedules.",
      },
      {
        question: "A fast-growing SaaS company with no profits trades at 15x sales. What additional metric is most important to assess whether this is cheap or expensive?",
        choices: [
          "Its P/E ratio",
          "Its gross margin",
          "Its EV/EBITDA",
          "Its book value",
        ],
        correctIndex: 1,
        explanation: "Gross margin tells you how much of each revenue dollar flows through to fund growth and eventual profit. A 15x P/S on 80% gross margins is very different from 15x on 30% gross margins.",
      },
    ],
  },

  {
    slug: "moats",
    title: "What Makes a Durable Moat",
    subtitle: "The five sources of competitive advantage — and how to spot them.",
    readMinutes: 6,
    sections: [
      {
        heading: "Why moats matter",
        body: "A business without a competitive moat is like a castle with no walls: any competitor can walk in and take its profits. A moat is what allows a company to earn returns on capital above its cost of capital for a sustained period. Without one, competition drives margins to zero. Buffett popularised the concept; the academic framework behind it is Michael Porter's Five Forces.",
      },
      {
        heading: "Switching costs",
        body: "If it's painful, expensive, or risky for customers to leave, they won't — even if a cheaper alternative exists. Enterprise software is the classic example: migrating a company's ERP system takes years and costs millions. High switching costs create pricing power and predictable retention. Look for high net revenue retention rates (>120% is exceptional), low churn, and revenue that expands inside existing customers.",
      },
      {
        heading: "Network effects",
        body: "A network effect exists when the product becomes more valuable as more people use it. Visa's payment network, LinkedIn's professional graph, and Airbnb's two-sided marketplace all become harder to displace with every new user. Network effects are the most powerful moat because they're self-reinforcing — but they're also fragile: a better network can grow faster than yours. Distinguish between real network effects (value scales with users) and fake ones (merely 'big').",
      },
      {
        heading: "Cost advantages and scale",
        body: "Some businesses have structural cost advantages that competitors cannot replicate: proprietary manufacturing processes, exclusive raw material contracts, or simply massive scale (fixed costs spread over more units). Walmart, Amazon's fulfilment network, and Costco's membership model all create cost advantages that compound over time. The test: can a well-funded competitor replicate this at a reasonable cost? If yes, it's not a moat.",
      },
      {
        heading: "Intangible assets",
        body: "Brands, patents, regulatory licences, and data can all create durable advantages. A strong brand lets a company charge premium prices without losing volume (think Apple or LVMH). Patents grant legal monopolies for 20 years. Regulatory moats (banking licences, pharmaceutical approvals, utility franchises) can be nearly impenetrable. The risk: brand moats erode if quality slips; patents expire; regulation can change.",
      },
    ],
    quiz: [
      {
        question: "A cloud software company reports 130% net revenue retention. What does this indicate?",
        choices: [
          "It lost 30% of its customers this year",
          "Existing customers are spending 30% more than last year",
          "It grew total revenue by 30%",
          "New customers represent 130% of churn",
        ],
        correctIndex: 1,
        explanation: "Net revenue retention above 100% means the revenue from last year's cohort of customers has grown — customers are buying more (expansion revenue) than the company loses from churn.",
      },
      {
        question: "Which of the following is the best example of a network effect moat?",
        choices: [
          "A pharmaceutical company with a patented drug",
          "A payment network where more merchants and cardholders attract each other",
          "A manufacturer with proprietary low-cost production technology",
          "A retailer with exclusive supplier contracts",
        ],
        correctIndex: 1,
        explanation: "A payment network exhibits a classic two-sided network effect: more cardholders attract more merchants, which attracts more cardholders. Value scales with the number of participants.",
      },
      {
        question: "What is the most important test of whether a cost advantage constitutes a durable moat?",
        choices: [
          "Whether the company has higher margins than the industry average",
          "Whether a well-funded competitor could replicate the advantage at reasonable cost",
          "Whether the company is the largest player in its market",
          "Whether the company has a recognised brand",
        ],
        correctIndex: 1,
        explanation: "A cost advantage is only a moat if it's hard to replicate. Scale advantages from a new warehouse, for example, can be copied by a competitor who builds one — that's not a moat. The test is durability.",
      },
    ],
  },

  {
    slug: "dcf-basics",
    title: "DCF Basics: Valuing a Business",
    subtitle: "How discounted cash flow works — and why the assumptions matter more than the math.",
    readMinutes: 7,
    sections: [
      {
        heading: "The core idea",
        body: "A business is worth the present value of all the cash it will generate for its owners in the future. That's the entire premise of discounted cash flow (DCF) analysis. 'Discounting' means adjusting future cash flows back to today's dollars, because a dollar today is worth more than a dollar in five years — it can be invested in the meantime. The discount rate reflects that opportunity cost plus the risk of the investment.",
      },
      {
        heading: "Free cash flow",
        body: "The cash flows we discount are Free Cash Flow to the Firm (FCFF) or Free Cash Flow to Equity (FCFE). Free cash flow = operating cash flow minus capital expenditures. It represents the cash the business generates after maintaining and growing its asset base — the cash truly 'free' to be distributed to debt and equity holders. Unlike earnings, FCF is hard to manipulate: cash either exists or it doesn't.",
      },
      {
        heading: "The discount rate (WACC)",
        body: "The Weighted Average Cost of Capital (WACC) is the blended required return of the company's debt and equity holders. Equity is more expensive than debt (equity is riskier and dividends aren't tax-deductible). A typical WACC for a large-cap US company might be 8–10%. For a higher-risk, high-growth company, you might use 12–15%. \n\nThe discount rate is the most impactful input in a DCF. A change of 1–2 percentage points can shift the fair value estimate by 20–30%. This is why DCFs are often called 'garbage in, garbage out' models — small assumption changes produce huge output swings.",
      },
      {
        heading: "Terminal value",
        body: "Most of a DCF's value comes from the 'terminal value' — what the business is worth after the explicit forecast period (usually 5–10 years). Terminal value is typically calculated using the Gordon Growth Model: TV = FCF × (1 + g) ÷ (WACC − g), where g is the assumed perpetual growth rate. If you assume the company grows at 4% forever with a 9% WACC, that's a 5% 'spread'. Even a half-point change in the terminal growth rate moves fair value by 10–15%.",
      },
      {
        heading: "Using DCF in practice",
        body: "Professional investors don't use DCF to arrive at a precise price target — they use it to sanity-check a market price. 'What growth rate does this price imply?' is more useful than 'what's the exact fair value?' Scenario analysis (base/bull/bear) makes the model more honest by showing the range of outcomes rather than a false point estimate. This is exactly what the DCF Scenarios feature in this app is designed to do.",
      },
    ],
    quiz: [
      {
        question: "Free cash flow is best defined as:",
        choices: [
          "Net income plus depreciation",
          "Operating cash flow minus capital expenditures",
          "Revenue minus all expenses",
          "EBITDA minus taxes",
        ],
        correctIndex: 1,
        explanation: "FCF = operating cash flow − capex. It represents cash generated after sustaining and growing the business — the cash available to all capital providers.",
      },
      {
        question: "You build a DCF for a company using a 9% WACC and 3% terminal growth rate. A colleague argues the growth rate should be 4%. What is the most likely effect?",
        choices: [
          "The fair value estimate decreases significantly",
          "The fair value estimate increases significantly",
          "Only the near-term cash flows change",
          "The WACC adjusts to compensate",
        ],
        correctIndex: 1,
        explanation: "Terminal growth rate and WACC form a spread that determines the terminal value multiple. Narrowing the spread from 6% (9−3) to 5% (9−4) increases the terminal value — often by 20–30% of the total fair value.",
      },
      {
        question: "What is the most honest way to use a DCF model in practice?",
        choices: [
          "Use it to produce a single precise price target",
          "Ignore terminal value and focus only on the 5-year forecast",
          "Build base/bull/bear scenarios to show a range of outcomes",
          "Use market comparables instead of DCF",
        ],
        correctIndex: 2,
        explanation: "A DCF is extremely sensitive to assumptions. Scenario analysis makes the uncertainty explicit rather than hiding it inside a single number, which is a more intellectually honest approach.",
      },
    ],
  },

  {
    slug: "earnings-reports",
    title: "How to Read an Earnings Report",
    subtitle: "What actually matters when results hit — and what to ignore.",
    readMinutes: 5,
    sections: [
      {
        heading: "The beat/miss game",
        body: "Every quarter, companies report results against Wall Street's consensus estimates. A 'beat' means results came in above expectations; a 'miss' means below. But this game is more complicated than it seems. Analysts' estimates are anchored by guidance management gives them — and management almost always guides conservatively (sandbagging) so they can 'beat'. A 'beat' on guidance-anchored estimates tells you very little about business quality.",
      },
      {
        heading: "What actually matters",
        body: "Focus on these four things in order: (1) Revenue trajectory — is the top-line growth rate accelerating, decelerating, or stable? A deceleration often matters more than whether it beat by a penny. (2) Margins — are gross and operating margins expanding or contracting, and why? (3) Guidance — what is management saying about next quarter and next year? The stock often moves more on guidance than on reported results. (4) Cash flow — is the earnings quality confirmed by free cash flow, or is working capital absorbing cash?",
      },
      {
        heading: "The press release vs. the transcript",
        body: "The press release is management's best spin on the quarter. The earnings call transcript — especially the Q&A — is where you learn what's really going on. Analysts ask the awkward questions management didn't volunteer. Pay attention to what management spends most time defending: that's usually where the problem is. Confident management teams give specific, data-backed answers. Evasive answers about key metrics are a yellow flag.",
      },
      {
        heading: "Checking your thesis",
        body: "Every earnings report is a thesis checkpoint. Before reading results, write down the 2–3 things that most need to be true for your investment thesis to hold. Then check whether this quarter moved the needle on those. A big beat on a metric you don't care about is noise. A small miss on the one metric your thesis depends on is signal. This is what the 'Thesis Checkpoints' feature in this app is designed to enforce.",
      },
    ],
    quiz: [
      {
        question: "A company beats analyst EPS estimates by 10% but cuts its revenue guidance for next quarter by 5%. What is most likely to happen to the stock?",
        choices: [
          "It rises sharply on the earnings beat",
          "It falls because guidance disappointed",
          "It is unchanged as the two effects cancel",
          "It depends only on the P/E ratio",
        ],
        correctIndex: 1,
        explanation: "Markets are forward-looking. Guidance cuts often weigh more heavily than backward-looking beats because they reset expectations for the next quarter. Stocks frequently sell off on bad guidance despite reported beats.",
      },
      {
        question: "During an earnings call Q&A, an analyst asks about customer churn and the CFO gives a vague, non-quantitative answer. This should be treated as:",
        choices: [
          "Reassuring — management is not alarmed",
          "A potential yellow flag worth investigating further",
          "Normal — CFOs rarely discuss churn specifics",
          "Positive — vague answers mean no material change",
        ],
        correctIndex: 1,
        explanation: "Evasive answers to specific quantitative questions about key metrics are a warning sign. Confident management teams with strong metrics tend to be specific. Vagueness often signals a problem they're not ready to disclose.",
      },
      {
        question: "What is the most disciplined way to use earnings reports to improve your investing?",
        choices: [
          "React to whether the stock beat or missed consensus estimates",
          "Track only revenue and net income",
          "Define thesis checkpoints before results and assess how the report affects them",
          "Focus on the press release headline metrics",
        ],
        correctIndex: 2,
        explanation: "Pre-committing to the 2–3 things that must be true for your thesis prevents you from being swayed by noise. It's the only way to distinguish whether a quarter matters for your specific investment case.",
      },
    ],
  },
];

export const findModule = (slug: string): LearnModule | undefined =>
  LEARN_MODULES.find((m) => m.slug === slug);
