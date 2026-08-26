export interface BlogSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface BlogPost {
  slug: string;
  category: "IR35 essentials" | "Contract decisions" | "Working practices";
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  accent: "emerald" | "amber" | "sky" | "violet" | "rose";
  takeaways: string[];
  sections: BlogSection[];
  sources: Array<{ label: string; href: string }>;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "inside-vs-outside-ir35-contract-checks",
    category: "IR35 essentials",
    title: "Inside vs Outside IR35: five checks before you accept a contract",
    description: "A practical way to compare the tax status, working arrangement and commercial reality of a UK contract before you commit.",
    publishedAt: "2026-08-26",
    updatedAt: "2026-08-26",
    readingMinutes: 7,
    accent: "emerald",
    takeaways: [
      "Treat the advert label as a useful signal, not the final determination.",
      "Ask for the Status Determination Statement and the reasons behind it when the client is responsible.",
      "Compare the real working practices with the written contract before accepting.",
    ],
    sections: [
      {
        heading: "1. Confirm who is responsible for the determination",
        paragraphs: [
          "IR35 applies to each engagement separately. In most public sector and medium or large private sector engagements, the client decides the worker's employment status for tax. If the end client is a small private sector business, responsibility can remain with the worker's intermediary.",
          "Ask the recruiter who the end client is, whether the client is responsible for the determination and when you will receive the reasons for that decision.",
        ],
      },
      {
        heading: "2. Read the reasons, not only the label",
        paragraphs: [
          "An advert marked Outside IR35 is helpful, but the label alone does not explain why. Where the client is responsible, a Status Determination Statement should state the decision and the reasons for it.",
        ],
        bullets: [
          "Who controls what work is done and how it is delivered?",
          "Can a suitably qualified substitute genuinely be provided?",
          "Is there an ongoing obligation to offer and accept work?",
          "Does the contractor carry meaningful financial risk?",
        ],
      },
      {
        heading: "3. Compare the contract with day-to-day reality",
        paragraphs: [
          "Employment status is not decided by a single clause. A strong substitution clause is not useful if the client would never permit substitution in practice. A project description is not enough if the contractor is managed like an employee every day.",
          "Before starting, ask who will set priorities, approve leave, provide equipment, decide working hours and accept completed deliverables.",
        ],
      },
      {
        heading: "4. Model the commercial outcome",
        paragraphs: [
          "Compare more than the headline day rate. Include expected billable days, umbrella margin where relevant, pension choices, professional insurance, accounting costs, unpaid time and the risk of early termination.",
          "Use estimates as a comparison aid. Personal tax outcomes depend on individual circumstances and can change when legislation or assumptions change.",
        ],
      },
      {
        heading: "5. Keep the evidence",
        paragraphs: [
          "Save the advert, contract, determination, project scope and any clarification about working practices. If the engagement changes, revisit the status rather than assuming the original decision still fits.",
        ],
      },
    ],
    sources: [
      { label: "HMRC: Understanding off-payroll working", href: "https://www.gov.uk/guidance/understanding-off-payroll-working-ir35" },
      { label: "HMRC: Check Employment Status for Tax", href: "https://www.gov.uk/guidance/check-employment-status-for-tax" },
    ],
  },
  {
    slug: "status-determination-statement-contractor-guide",
    category: "IR35 essentials",
    title: "Status Determination Statements: what UK contractors should look for",
    description: "What an SDS is, when you should receive one and how to review the reasoning without turning the process into a legal maze.",
    publishedAt: "2026-08-26",
    updatedAt: "2026-08-26",
    readingMinutes: 6,
    accent: "amber",
    takeaways: [
      "An SDS should contain a status conclusion and the reasons for it.",
      "The decision should relate to the actual engagement, not a generic role template.",
      "A contractor can challenge a determination through the client's disagreement process.",
    ],
    sections: [
      {
        heading: "What an SDS should tell you",
        paragraphs: [
          "A Status Determination Statement records whether the worker is employed or self-employed for tax purposes and explains why. There is no single mandated layout, but a bare Inside or Outside label without reasons is not the same as a reasoned statement.",
          "The useful part is the reasoning. It should connect the facts of the engagement to the conclusion.",
        ],
      },
      {
        heading: "Questions to ask when reviewing it",
        paragraphs: ["Read the statement beside the contract and planned working practices."],
        bullets: [
          "Does it identify the correct client, worker and engagement?",
          "Does it describe who controls the work, location and schedule accurately?",
          "Does it reflect any genuine substitution arrangement?",
          "Does it consider equipment, financial risk and integration?",
          "Were reasonable steps taken to reach the decision?",
        ],
      },
      {
        heading: "If the facts do not match",
        paragraphs: [
          "Write down the specific facts you believe are wrong and provide evidence. Avoid arguing only from the preferred tax outcome. A focused disagreement explains what the client misunderstood and how the engagement will actually operate.",
          "The client-led disagreement process is the appropriate route when the client is responsible. Seek specialist advice where the engagement is complex or the financial consequences are material.",
        ],
      },
      {
        heading: "Keep it current",
        paragraphs: [
          "An engagement can change. A new manager, a shift from deliverables to ongoing duties or tighter control can alter the working arrangement. Recheck the determination when the material facts change.",
        ],
      },
    ],
    sources: [
      { label: "HMRC: Deemed employer responsibilities and SDS guidance", href: "https://www.gov.uk/guidance/fee-payer-responsibilities-under-the-off-payroll-working-rules" },
      { label: "HMRC: Understanding off-payroll working", href: "https://www.gov.uk/guidance/understanding-off-payroll-working-ir35" },
    ],
  },
  {
    slug: "ir35-working-practices-contract-wording",
    category: "Working practices",
    title: "IR35 and working practices: why the contract wording is not enough",
    description: "How control, substitution and the wider working relationship show up in the real life of a contract engagement.",
    publishedAt: "2026-08-26",
    updatedAt: "2026-08-26",
    readingMinutes: 8,
    accent: "sky",
    takeaways: [
      "Status follows the full engagement, including implied and verbal arrangements.",
      "A clause must be genuine and usable in practice.",
      "Document changes to scope, control and delivery as the contract progresses.",
    ],
    sections: [
      {
        heading: "The engagement is wider than the PDF",
        paragraphs: [
          "HMRC describes a contract for off-payroll purposes as written, verbal or implied. That means emails, operating habits and management expectations can matter alongside the signed document.",
          "The safest approach is consistency. The statement of work, contract, onboarding and everyday delivery should describe the same commercial relationship.",
        ],
      },
      {
        heading: "Control in practical terms",
        paragraphs: [
          "Control is not limited to technical supervision. Consider who decides the deliverables, order of work, location, schedule and method. A client can define an outcome and maintain governance without necessarily directing every aspect of delivery.",
        ],
      },
      {
        heading: "Substitution must be real",
        paragraphs: [
          "A substitution clause is stronger when the contractor can identify, arrange and pay a qualified substitute, subject to reasonable client safeguards. It is weaker when every replacement would be refused or the individual must always perform the work personally.",
        ],
      },
      {
        heading: "Look at the wider commercial picture",
        paragraphs: ["No single factor should be treated as a magic switch. Review the relationship as a whole."],
        bullets: [
          "Is the contractor paid for a deliverable or simply for ongoing availability?",
          "Who corrects defective work and bears the cost?",
          "Is the contractor part of the client's organisation or an external supplier?",
          "Is there an expectation of continuous future work?",
        ],
      },
      {
        heading: "Create a simple evidence habit",
        paragraphs: [
          "Keep accepted deliverables, change requests, invoices, project decisions and evidence of commercial risk. The goal is not to manufacture an Outside IR35 story. It is to preserve an accurate record of how the engagement operated.",
        ],
      },
    ],
    sources: [
      { label: "HMRC: Check Employment Status for Tax", href: "https://www.gov.uk/guidance/check-employment-status-for-tax" },
      { label: "HMRC: Understanding off-payroll working", href: "https://www.gov.uk/guidance/understanding-off-payroll-working-ir35" },
    ],
  },
  {
    slug: "umbrella-or-limited-company-contractor-checklist",
    category: "Contract decisions",
    title: "Umbrella or limited company: a practical contractor checklist",
    description: "A decision framework for comparing engagement routes without reducing the choice to a single take-home number.",
    publishedAt: "2026-08-26",
    updatedAt: "2026-08-26",
    readingMinutes: 7,
    accent: "violet",
    takeaways: [
      "The engagement route and IR35 status are related but not interchangeable.",
      "Compare the full assignment rate, deductions, costs and responsibilities.",
      "Verify the provider and avoid arrangements promising unusually high retained income.",
    ],
    sections: [
      {
        heading: "Start with the engagement route",
        paragraphs: [
          "If you are employed by an umbrella company, HMRC says the off-payroll working rules are unlikely to apply to you. The umbrella normally employs you and operates PAYE. A personal service company is different: it is your intermediary and the off-payroll rules may apply to each engagement.",
        ],
      },
      {
        heading: "For an umbrella engagement",
        paragraphs: ["Ask for a clear reconciliation from the assignment rate to your gross pay and estimated net pay."],
        bullets: [
          "Umbrella margin and any other fees",
          "Employer costs taken from the assignment rate",
          "Holiday pay method and pension treatment",
          "Who carries professional insurance",
          "How expenses are handled",
        ],
      },
      {
        heading: "For a limited company engagement",
        paragraphs: [
          "Consider accounting, insurance, company administration, payment terms, gaps between contracts and the commercial obligations in the agreement. An Outside IR35 label does not remove those responsibilities.",
        ],
      },
      {
        heading: "Be cautious with avoidance claims",
        paragraphs: [
          "Treat promises of unusually high take-home pay as a warning sign. HMRC specifically warns contractors about schemes that claim to get around the off-payroll rules. Independent professional advice can be valuable before joining an unfamiliar arrangement.",
        ],
      },
    ],
    sources: [
      { label: "HMRC: Understanding off-payroll working and umbrella companies", href: "https://www.gov.uk/guidance/understanding-off-payroll-working-ir35" },
      { label: "HMRC: Tax avoidance schemes aimed at contractors", href: "https://www.gov.uk/guidance/understanding-off-payroll-working-ir35#tax-avoidance-schemes" },
    ],
  },
  {
    slug: "compare-uk-contract-offers-beyond-day-rate",
    category: "Contract decisions",
    title: "How to compare UK contract offers beyond the day rate",
    description: "A scorecard for rate, IR35 status, duration, payment risk, working pattern and the value of the experience itself.",
    publishedAt: "2026-08-26",
    updatedAt: "2026-08-26",
    readingMinutes: 6,
    accent: "rose",
    takeaways: [
      "Convert the headline rate into a realistic annual and monthly scenario.",
      "Price the risks of notice, payment terms, travel and non-billable time.",
      "Compare role quality and future market value as well as current cash flow.",
    ],
    sections: [
      {
        heading: "Build a realistic revenue scenario",
        paragraphs: [
          "Multiply the rate by realistic billable days, not every weekday in the year. Remove expected holidays, training, illness, gaps, public holidays where they are not billable and time spent finding the next contract.",
        ],
      },
      {
        heading: "Price the contract risks",
        paragraphs: ["Two roles with the same rate can have very different value."],
        bullets: [
          "Contract length and likelihood of extension",
          "Notice period and termination rights",
          "Payment terms and supply chain strength",
          "Travel, accommodation and equipment costs",
          "Professional insurance and compliance costs",
        ],
      },
      {
        heading: "Compare the working arrangement",
        paragraphs: [
          "A remote role may reduce cost and improve flexibility. A hybrid role may offer stronger stakeholder access. An Inside IR35 engagement may still be commercially attractive at the right assignment rate. Compare the complete arrangement rather than rejecting or accepting on one label alone.",
        ],
      },
      {
        heading: "Value the next opportunity",
        paragraphs: [
          "Consider whether the project creates credible evidence for your next contract. A strong delivery outcome, modern platform or regulated environment can improve future positioning, but only when the work genuinely matches your direction.",
        ],
      },
      {
        heading: "Use a repeatable scorecard",
        paragraphs: [
          "Score rate, status confidence, duration, payment risk, flexibility, learning value and client quality. Add a short reason for each score. A repeatable method makes it easier to compare offers when the headlines are noisy.",
        ],
      },
    ],
    sources: [
      { label: "HMRC: Understanding off-payroll working", href: "https://www.gov.uk/guidance/understanding-off-payroll-working-ir35" },
      { label: "HMRC: Check Employment Status for Tax", href: "https://www.gov.uk/guidance/check-employment-status-for-tax" },
    ],
  },
];

export function getBlogPost(slug: string) {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function formatBlogDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}
