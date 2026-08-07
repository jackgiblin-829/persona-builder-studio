/**
 * Seed evidence corpus for the demo brand (Northwind Analytics).
 *
 * Everything here is invented. No real person, company, quote, email address
 * or domain appears; all domains use the reserved `.example` TLD. The corpus is
 * deliberately written to contain three genuinely different buyers — a
 * security-led technical evaluator, an adoption-led functional manager, and a
 * cost-and-implementation-focused small-team buyer — plus some contradictions,
 * so segmentation has something real to separate and the confidence heuristic
 * has contradictions to penalise.
 *
 * A few records contain synthetic PII (fake emails and phone numbers) so the
 * redaction pipeline is exercised end to end by the seed itself.
 */

export type SeedSource = {
  label: string;
  sourceType:
    | "sales_transcript"
    | "support_ticket"
    | "review"
    | "search_console"
    | "brand_page"
    | "interview";
  format: "transcript" | "csv" | "json" | "search_console_csv" | "markdown";
  filename: string;
  contentType: string;
  observedAt: string;
  content: string;
};

const SALES_TRANSCRIPT = `Facilitator: Thanks for making time. Before we start, can you describe what you're trying to solve?

Prospect: We're trying to replace a reporting setup that our data team maintains by hand. The goal is to give product managers self-serve access to product analytics without the security team blocking it. That's really the whole problem in one sentence.

Facilitator: What's blocked it so far?

Prospect: Customer data cannot leave our approved cloud environment. That's non-negotiable for us. We're a healthcare payer, so anything that ships event data to a vendor's multi-tenant cloud is dead on arrival at security review. Last time we tried a tool like this we got three months into procurement before the architecture review killed it.

Facilitator: How do you evaluate vendors given that?

Prospect: The deciding factor is deployment model first, then governance. If it can't run in our own VPC we don't even take the demo. After that I need column-level data lineage — I have to be able to answer "where did this number come from" for an auditor. And role-based access has to be real, not a checkbox.

Facilitator: What evidence do you need to see?

Prospect: Send me the SOC 2 Type II report, the architecture diagram showing where data lives, and the pen test summary. A customer reference in healthcare or financial services would help a lot. Marketing case studies about ecommerce brands are useless to me.

Facilitator: What does success look like twelve months in?

Prospect: Success means the platform is deployed inside our environment, security has signed off, and product managers are actually using it. If adoption is under 60 percent of the product org I'd call it a failure regardless of how good the technology is.

Facilitator: Anything about the implementation itself?

Prospect: We have limited implementation staff. Two data engineers, and they're already oversubscribed. So the rollout has to be mostly self-service after initial setup. If it needs a six-week professional services engagement, that's a real problem.

Facilitator: What about timeline?

Prospect: Our current contract renews in about five months, so we have a deadline. Realistically we need to be in production within that window or we renew the incumbent for another year.

Facilitator: Who else is involved in the decision?

Prospect: Security architecture has veto. Procurement runs the vendor assessment. I own the recommendation. Product leadership cares about adoption, and honestly they push back on anything that adds friction to their workflow.

Facilitator: Have you looked at alternatives?

Prospect: We looked at Cobalt Insights, but they're cloud-only, so that ended quickly. Tessellate BI is what we have now — it's fine for finance reporting but product teams find it too slow to answer a question. I think Perch Metrics is too small for us, though I'm not certain.

Facilitator: Anything you're worried about with a private-cloud deployment?

Prospect: My concern is that self-hosted versions are always a second-class product. You get the features six months late and the docs assume you're on the cloud version. If that's how it works, we'd rather not.

Facilitator: What would you need to see to believe otherwise?

Prospect: Show me the release notes for the last four releases and prove the self-hosted version shipped at the same time. That's a factual claim I can verify.`;

const SUPPORT_TICKETS_CSV = `ticket_id,date,role,subject,text
T-4411,2026-05-02,product manager,Dashboards nobody opens,"We rolled out to 40 product managers and about 8 of them log in weekly. The problem is that answering a new question still requires filing a request with the data team, so people gave up. What we want is for a PM to be able to change a breakdown without learning SQL."
T-4429,2026-05-08,product manager,Onboarding takes too long,"It took our team three weeks to onboard because every new user needed a walkthrough. Ideally onboarding would be self-serve with templates for common product questions. Adoption is the metric my VP asks about, not query volume."
T-4437,2026-05-14,analytics lead,Definition drift,"Two teams report different numbers for activation and both say they're right. We need a semantic layer so a metric is defined once. Without that people stop trusting the dashboards, and once trust is gone adoption never recovers."
T-4455,2026-05-21,product manager,Workflow disruption,"Honestly the biggest blocker is that this lives outside where we work. If I have to leave the planning tool, open another tab, and remember a dashboard name, I won't do it. Can you explain how the Slack integration works?"
T-4462,2026-05-29,data engineer,Warehouse sync failures,"Our Snowflake sync fails silently about once a week and we only find out when a PM says a number looks wrong. We need alerting on pipeline failures. This keeps breaking and it wastes a day each time."
T-4470,2026-06-03,product manager,Training material,"Do you have short training videos? Our team is distributed and a two-hour live session doesn't work. Reach me at rowan.kestrel@northwind-payer.example or +1 (555) 010-8842 if easier."
T-4488,2026-06-11,analytics lead,Access requests,"Every access request goes through me and it's become a part-time job. We want role-based access so a team lead can grant access within their own team without involving central analytics."
T-4501,2026-06-18,product manager,Adoption reporting,"Success for us looks like 70 percent of PMs running at least one self-serve query per week within a quarter. Right now we have no visibility into who is actually using what."
T-4510,2026-06-25,product manager,Too many dashboards,"We have dashboard sprawl. Four hundred dashboards, nobody knows which is canonical. We need a way to deprecate and certify. This is more painful than any missing feature."`;

const REVIEWS_JSON = JSON.stringify(
  {
    records: [
      {
        review_id: "R-101",
        date: "2026-04-12",
        author: "verified reviewer, seed-stage SaaS",
        rating: 4,
        title: "Good fit for a small team if you can do the setup",
        text: "We're a team of nine and we set this up ourselves in about two days. Total cost of ownership mattered more than features for us — we compared three tools and picked on price plus how fast we could get value. What I'd love is a cheaper tier that doesn't include the governance module we'll never use.",
      },
      {
        review_id: "R-108",
        date: "2026-04-19",
        author: "verified reviewer, agency",
        rating: 3,
        title: "Implementation effort is real",
        text: "The docs assume you already have a data warehouse. We don't. We had to stand up BigQuery first, which added two weeks nobody planned for. If you're a small team without a data engineer, budget for that. The product itself is fine once it's running.",
      },
      {
        review_id: "R-115",
        date: "2026-05-03",
        author: "verified reviewer, fintech",
        rating: 5,
        title: "The lineage view won the security review for us",
        text: "Our security team asked where every field originated and we could show column-level lineage on screen. That single feature is why we bought it. Deployment in our own cloud account was the other requirement and it was supported without a custom contract.",
      },
      {
        review_id: "R-122",
        date: "2026-05-17",
        author: "verified reviewer, marketplace",
        rating: 2,
        title: "Pricing is hard to predict",
        text: "Seat licence pricing punishes exactly the behaviour they want, which is more people using it. We cannot justify adding read-only viewers at full seat price. We're evaluating alternatives to X on cost alone at renewal.",
      },
      {
        review_id: "R-130",
        date: "2026-06-02",
        author: "verified reviewer, healthcare",
        rating: 4,
        title: "Self-hosted is genuinely maintained",
        text: "I was worried the self-hosted build would lag. It hasn't — the last three releases landed the same week as cloud. Worth verifying yourself, but it held up for us.",
      },
      {
        review_id: "R-141",
        date: "2026-06-20",
        author: "verified reviewer, small team",
        rating: 4,
        title: "Fast time to value",
        text: "Time to value was under a week for us. We're not doing anything sophisticated — funnel and retention on one product. For that, it's more than enough and we didn't need help from anyone.",
      },
    ],
  },
  null,
  2,
);

const SEARCH_CONSOLE_CSV = `query,clicks,impressions,ctr,position
self-hosted product analytics,58,1420,4.08%,7.2
product analytics private cloud,41,980,4.18%,6.4
hipaa compliant analytics platform,37,1130,3.27%,9.1
column level data lineage tool,29,610,4.75%,5.8
soc 2 analytics tools for healthcare,24,840,2.86%,11.3
what is data lineage,88,7210,1.22%,14.6
product analytics tools comparison,66,4310,1.53%,12.9
best product analytics for small teams,52,3980,1.31%,13.7
how to improve dashboard adoption,44,2870,1.53%,10.2
analytics semantic layer explained,31,1990,1.56%,15.1
tessellate bi alternatives,27,720,3.75%,8.4
cobalt insights vs northwind analytics,19,340,5.59%,4.1
product analytics pricing per seat,23,1240,1.85%,16.2
analytics tool implementation checklist,18,910,1.98%,13.4
does product analytics need a data warehouse,15,1080,1.39%,17.8
migrate from tessellate bi,12,290,4.14%,6.9
analytics for teams without data engineers,11,760,1.45%,18.3
vpc deployment analytics vendor,9,210,4.29%,5.5`;

const BRAND_PAGE_MD = `# Northwind Analytics — product analytics you can actually deploy

Northwind Analytics is a product-analytics platform built for teams whose data
cannot leave their own cloud. We deliver self-hosted and private-cloud
deployment as a first-class option, not an afterthought.

## Deployment

Our platform provides single-tenant deployment inside your own cloud account.
Customer event data never transits our infrastructure. Self-hosted releases ship
on the same schedule as our cloud release.

## Governance

The Governance Console offers role-based access control, configurable retention
policies and exportable audit trails. Column-level data lineage traces every
metric back through transformations to its source table.

## Who uses Northwind

We are trusted by data, security and product teams in healthcare, financial
services and public sector organisations. Our customers typically complete a
security review in weeks rather than months.

## Getting started

Book a technical demo, or start a 14-day private-cloud trial. Most teams reach
their first self-serve answer within a week of deployment.`;

const INTERVIEW_NOTES = `Interviewer: You bought about six months ago. Walk me through how you decided.

Founder: We're eleven people, no data engineer. So the question was never "which tool has the best feature set", it was "which one can we run without hiring someone".

Interviewer: How did you narrow it down?

Founder: Implementation effort and total cost of ownership. I made a spreadsheet with setup time, monthly cost at our headcount, and whether it needed a warehouse. That's the whole evaluation. Governance controls and lineage were irrelevant to us — we have no compliance requirement.

Interviewer: What almost stopped you?

Founder: Pricing predictability. Per-seat pricing at our growth rate is scary. I need to know what this costs at thirty people, and that was hard to work out from the pricing page.

Interviewer: What does success look like?

Founder: Time to value. We wanted a working activation funnel in under a week and we got it in four days. That's it. If it had taken a month we'd have gone back to spreadsheets.

Interviewer: Anything you needed that wasn't there?

Founder: A cheaper read-only seat. And honestly, templates. We didn't know what to measure. A checklist of "here are the five things a company like you should track" would have saved us a fortnight of arguing.

Interviewer: Would security requirements ever change that?

Founder: Maybe eventually if we sell to enterprises, but not now. I think that's a year away, possibly more.`;

export const SEED_SOURCES: SeedSource[] = [
  {
    label: "Discovery call — regulated payer, security-led evaluation",
    sourceType: "sales_transcript",
    format: "transcript",
    filename: "discovery-call-regulated-payer.txt",
    contentType: "text/plain",
    observedAt: "2026-06-14T15:00:00Z",
    content: SALES_TRANSCRIPT,
  },
  {
    label: "Support tickets — adoption and workflow themes (Q2)",
    sourceType: "support_ticket",
    format: "csv",
    filename: "support-tickets-q2.csv",
    contentType: "text/csv",
    observedAt: "2026-06-25T00:00:00Z",
    content: SUPPORT_TICKETS_CSV,
  },
  {
    label: "Verified product reviews export",
    sourceType: "review",
    format: "json",
    filename: "reviews-export.json",
    contentType: "application/json",
    observedAt: "2026-06-20T00:00:00Z",
    content: REVIEWS_JSON,
  },
  {
    label: "Search Console export — last 90 days",
    sourceType: "search_console",
    format: "search_console_csv",
    filename: "search-console-90d.csv",
    contentType: "text/csv",
    observedAt: "2026-07-01T00:00:00Z",
    content: SEARCH_CONSOLE_CSV,
  },
  {
    label: "Customer interview — eleven-person startup buyer",
    sourceType: "interview",
    format: "transcript",
    filename: "interview-small-team-buyer.txt",
    contentType: "text/plain",
    observedAt: "2026-07-08T10:00:00Z",
    content: INTERVIEW_NOTES,
  },
  {
    label: "Brand homepage copy (positioning, not customer belief)",
    sourceType: "brand_page",
    format: "markdown",
    filename: "homepage.md",
    contentType: "text/markdown",
    observedAt: "2026-07-10T00:00:00Z",
    content: BRAND_PAGE_MD,
  },
];

/** The page the seeded homepage audit runs against. */
export const SEED_HOMEPAGE = {
  url: "https://northwind-analytics.example/",
  title: "Northwind Analytics — product analytics you can actually deploy",
  content: BRAND_PAGE_MD,
};
