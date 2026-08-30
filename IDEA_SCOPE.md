# USER — specific person

Riya is a 31-year-old Product Manager at a fintech app with roughly 500K monthly active users.

She owns activation and engagement. There is no dedicated user-research person, so she and one analyst review Play Store complaints, support summaries, and internal product signals when deciding what to fix next.

Riya needs to identify the most important recurring user problem quickly, explain it to her team with evidence, and decide whether it belongs with Engineering, Product, Support, or an in-app experience.

# PROBLEM — what's broken in their day

The recurring moment is Monday morning, when Riya needs to decide which user problem deserves attention next.

She has hundreds of Play Store reviews containing mixed ratings, duplicate complaints, vague feedback, bugs, feature requests, and unrelated comments. Today she reads a sample manually and turns it into a backlog using partial evidence and judgment.

The process fails because:

- Similar complaints are scattered across different wording.
- Frequency is difficult to estimate reliably.
- One loud complaint can appear more important than a widespread problem.
- Reviews do not clearly distinguish engineering issues from UX or education issues.
- Recommendations often jump straight to “add a tooltip” without deciding whether an in-app intervention can solve the problem.
- Riya cannot easily show the exact reviews supporting a backlog item.

Pulse should help her answer:

> What is the most important recurring user problem I should act on next, and can Digia meaningfully address it?

# WHAT V1 DOES — full user flow, step by step

## 1. Open the product

The first screen contains:

- One Google Play Store app URL field
- A short explanation of what the audit produces
- A prominent **Run Audit** button

[CHANGED — V1 AUTH SCOPE]

V1 does not require product-user authentication. The PM can start an audit directly after entering a valid URL.

## 2. Enter and validate the app

The user pastes a URL and selects **Run Audit**.

[CHANGED — PLAY STORE INGESTION]

The system accepts only supported Google Play Store app URLs. It validates that:

- The field is not empty.
- The URL is well formed.
- The URL belongs to Google Play Store.
- The app/package identifier can be extracted.

If the field is empty, show a required-field error and keep the user on the form.

If the URL is malformed, show a clear URL-format error and keep the user on the form.

If the URL is valid but is not a Google Play Store app URL, show a supported-source error and keep the user on the form.

No audit is created for any of these three input errors.

## 3. Create and run the audit

After successful validation and sign-in, the product creates an audit and begins scraping.

[CHANGED — PLAY STORE INGESTION]

The audit stores:

- Source Play Store URL
- App/package identifier
- App identity and metadata needed to identify the app
- Audit status
- Scrape status
- Scrape timestamp
- Creation time
- Current pipeline stage
- Error state, if applicable

While the audit runs, the user sees these stages:

1. Validating Play Store app
2. Collecting reviews
3. Normalizing and deduplicating reviews
4. Filtering review quality
5. Finding recurring problems
6. Consolidating related problems
7. Diagnosing problem types
8. Ranking opportunities
9. Preparing the audit

While submission is in progress, **Run Audit** is disabled so a double-click cannot create duplicate audits.

If the user submits the same app again after a previous audit has finished, the product creates a new audit with a new scrape timestamp. The previous audit remains unchanged and accessible through its direct audit link.

## 5. Scraper Agent — get the raw user feedback

[CHANGED — PLAY STORE INGESTION]

The Scraper Agent receives the Google Play Store app URL and:

- Validates that it is a supported Play Store URL.
- Identifies the app/package.
- Fetches available Play Store reviews.
- Collects as many recent reviews as the source returns, up to 500.
- Normalizes each review into a consistent structure.
- Removes duplicate review records.
- Preserves the original review text.
- Reports how many reviews were successfully collected.
- Surfaces scraping failures without fabricating reviews.

Each normalized review contains at minimum:

- Review ID or stable identifier
- Original review text
- Star rating
- Review date
- App/package identifier

The product may preserve reviewer name, device, app version, developer reply, or other metadata when the source provides it, but optional metadata is not required for V1.

## 6. Scraper failure and edge cases

[CHANGED — PLAY STORE INGESTION]

### App/package does not exist

Show an explicit **App not found** error. Do not create a completed audit and do not run AI analysis.

### App has no reviews

Complete the scrape with zero reviews and show an empty state:

> No reviews were found for this app. No recurring problems can be identified.

Do not run problem analysis and do not invent findings.

### App has fewer than 10 reviews

Continue the audit with the available reviews and label the audit **Low confidence**.

### Some reviews are malformed

Skip malformed records, preserve the valid records, and show how many records were skipped. Continue only if at least one valid review remains.

### Duplicate reviews are returned

Keep one normalized record for each stable review identifier. If no stable identifier exists, use a conservative duplicate check based on the available review fields. Do not count duplicates as separate evidence.

### Scraping partially succeeds

Continue with the valid reviews collected so far if at least one valid review is available. Mark the audit **Incomplete scrape** and show the number of reviews collected and the scrape limitation. The audit may also be labelled **Low confidence** when the partial dataset is small.

### Scraping completely fails

Show an explicit **Could not collect reviews** failure state with the reason when known and a **Retry audit** action. Do not run AI analysis and do not create fake or sample reviews.

### External source times out

Treat the timeout as a scraping failure. Show the failure state and **Retry audit** action. Do not show a partial success unless valid reviews were actually received.

### Retry after failure

Retry the same audit and replace the failed state when the retry begins. The failed state is not preserved as a separate audit version.

## 7. Review quality

Reviews that are empty, spammy, unrelated, or low quality remain stored but are marked low quality. They are excluded from problem evidence and scoring.

If all retrieved reviews are low quality, show:

> No usable reviews were found. No recurring problems can be identified.

Do not run problem analysis on an entirely unusable review set.

## 8. Researcher agent

The Researcher agent reads only the normalized, usable reviews and produces structured problem candidates.

Each candidate must contain:

- Problem statement
- Evidence review IDs
- Category
- Number of supporting signals
- Candidate confidence

A candidate without at least one evidence review ID is rejected.

A candidate supported by one review is allowed, but is labelled low confidence.

The Researcher must not invent a problem when there is no supporting review.

## 9. Product Analyst agent

The Product Analyst receives the structured candidates and their linked reviews.

It produces opportunities containing:

- User problem
- Supporting evidence review IDs
- Frequency
- Severity
- Confidence
- Trend
- Diagnosis
- Issue type
- Digia addressability
- Recommended owner

Supported issue types:

- Engineering
- UX
- Education
- Feature Gap
- Performance
- Data
- Support
- Other

When two clusters are nearly duplicates, V1 keeps them separate and marks them as **Possibly related**. It does not merge them automatically.

The PM can inspect the evidence behind either cluster.

## 10. AI output failures and insufficient evidence

If one AI agent returns malformed or incomplete structured output, mark the audit stage as failed, preserve the raw error for debugging, and let the PM retry the same audit.

If the audit has usable reviews but finds no recurring problem with enough evidence, show:

> No recurring problems found.

Also show the strongest unconfirmed signals separately, without ranking them as confirmed opportunities.

If evidence is insufficient for a particular finding, show the best available hypothesis with a prominent **Low confidence** warning. Do not present it as a confirmed recurring problem.

## 11. Addressability judgment

The Action Planner decides whether Digia can meaningfully address each problem.

For problems marked **No**, it recommends an owner such as:

- Engineering
- Product
- Support
- Other

For problems marked **Yes**, it may generate:

- Intervention hypothesis
- Target audience
- Trigger
- Experience type
- Suggested copy
- Success metric

Supported experience types:

- Spotlight
- Tooltip
- Bottom Sheet
- Walkthrough
- Inline Card
- Survey

If the PM disagrees with the judgment, they can change:

- Digia addressable: Yes / No
- Recommended owner
- Diagnosis
- Issue type

These changes are saved in the audit history.

If a finding has fewer than two supporting reviews, **Generate Fix** is disabled.

## 12. Calculate the ranking

The priority score is deterministic:

> `Impact × Confidence × Frequency × Trend`

Each input is scored from 1 to 10.

The model proposes the input values, but application code calculates the score.

The main audit list shows opportunities ranked by this score.

The PM can edit:

- Impact
- Frequency

Confidence and Trend remain AI-generated in V1.

When the PM edits Impact or Frequency, they must click **Recalculate ranking**. The system then:

1. Saves the edit.
2. Records who changed it and when.
3. Recalculates the score in code.
4. Reorders the opportunity list.
5. Adds the previous and new values to the audit history.

## 13. Audit result screen

The main audit result screen shows compact opportunity cards containing:

- Rank
- Problem statement
- Priority score
- Severity
- Digia addressability
- Supporting review count

The result screen also shows:

- Total reviews successfully collected
- Total usable reviews analyzed
- Number of malformed or low-quality reviews excluded
- Number of problems found
- Number of low-confidence findings
- Scrape status
- Audit status
- Last updated time

The full review text is not shown on the main list.

## 14. Opportunity detail screen

Selecting an opportunity opens its detail screen.

The detail screen contains:

- Problem statement
- Diagnosis
- Issue type
- Severity
- Frequency
- Confidence
- Trend
- Impact
- Priority score
- Digia addressability
- Recommended owner
- Related opportunity links
- Supporting review excerpts
- Review dates, ratings, and IDs
- PM edit controls
- Audit change history

The detail screen includes **Generate Fix** for Digia-addressable opportunities with at least two supporting reviews.

## 15. Generate Fix

When the PM selects **Generate Fix**, the Action Planner creates and saves a recommendation containing:

- Opportunity ID
- Audience
- Trigger
- Experience type
- Suggested copy
- Success metric
- Source opportunity
- Generation timestamp
- Generation status

The generated fix is a recommendation only. It does not publish anything to a live app.

If the opportunity is marked non-addressable or has fewer than two supporting reviews, **Generate Fix** is unavailable.

## 16. Persistence

[CHANGED — PLAY STORE INGESTION]

V1 persists only the information required to reproduce and inspect an audit:

- App/package identifier
- Source Play Store URL
- App identity metadata needed to identify the app
- Scrape status
- Scrape timestamp
- Scrape error details when a failure occurs
- Normalized reviews and their original IDs, text, ratings, dates, and package identifiers
- Review-quality labels
- Audit status and pipeline stage
- Problem candidates
- Evidence relationships
- Opportunities
- Ranking inputs and calculated ranking output
- Score edits
- Diagnosis edits
- Addressability edits
- Owner changes
- Generated recommendations
- Full version history

[CHANGED — V1 AUTH SCOPE]

The final audit remains viewable through its direct audit link after the user closes and reopens the product. V1 does not require authentication to open that link.

# WHAT V1 DOES NOT DO — everything parked

The following are explicitly excluded from this week’s build:

- App Store integration
- Any input source other than a Google Play Store app URL
- Manual upload or pre-provided review dumps as the normal V1 flow
- Generic web scraping
- Scraping sources other than Google Play Store
- Support-ticket integration
- WhatsApp integration
- Session replay
- Product analytics integration
- Slack reports
- Email reports
- Autonomous publishing
- Jira integration
- Linear integration
- Multi-source feedback correlation
- In-app intervention deployment
- Campaign creation inside Digia Engage
- Measuring whether an intervention improved user behaviour
- Agent configuration or agent hiring UI
- Custom agent roles
- User-configurable prompts
- Automatic merging of nearly duplicate opportunities
- Automatic correction of wrong diagnoses
- Automatic correction of wrong addressability decisions
- Editing Confidence
- Editing Trend
- Full ranking-input editing beyond Impact and Frequency
- Downloading or exporting Markdown
- Markdown export
- PDF exports
- Team workspaces
- Invitations and permissions
- Product-user authentication and passwordless email links
- Password-based authentication
- Billing or payments
- Mobile apps
- Real-time collaboration
- Large-scale historical synchronization beyond the V1 collection limit
- Guaranteed exhaustive review collection
- Retry history as separate audit versions
- Recommendations without visible evidence
- Counting unsupported, duplicate, malformed, or low-quality reviews as evidence
- Publishing a fix to a real customer app
- Jira, Linear, or other backlog creation
- Support or engineering ticket creation
- Scraping arbitrary websites or review platforms
- Filling failed scraping with fake, sample, cached, or hand-authored reviews

The V1 success condition is narrower:

> One PM enters one Google Play Store app URL, the product retrieves real reviews, and the PM confidently identifies the #1 user problem to act on next with traceable evidence.

# RISKIEST ASSUMPTION — what could make this pointless

[CHANGED — PLAY STORE INGESTION]

The primary riskiest assumption is now:

> Pulse can reliably retrieve enough useful review data from an arbitrary supported Google Play Store app URL to produce a meaningful audit.

This replaces the previous primary riskiest assumption because scraping is now a prerequisite for every downstream value claim. If the product cannot retrieve real reviews reliably, there is no grounded audit, no evidence trail, and no meaningful PM decision to evaluate.

The original assumption remains a secondary product risk:

> PMs will trust the evidence-backed top problem enough to use it in a real prioritization conversation, instead of treating it as another generic AI summary.

It should be tested only after scraping succeeds on real, previously untested apps.

The scraping assumption is supported if, across three previously untested Google Play Store app URLs:

1. At least two produce a usable review set without manual intervention.
2. Each successful audit retrieves enough valid reviews to identify at least one evidence-backed problem or honestly reports insufficient evidence.
3. No audit contains fabricated, duplicated, or untraceable review evidence.
4. A failed or timed-out scrape produces an explicit failure state rather than a fake result.

If fewer than two of three apps produce usable review data, do not expand the AI pipeline. Narrow the supported app/source conditions or reconsider the product before building further.

After scraping passes, test the secondary PM-trust assumption by giving three product managers audits from unfamiliar apps. The secondary assumption is supported if at least two of three:

1. Select the top-ranked problem or explain a clear correction.
2. Can trace the problem to real supporting reviews.
3. Say they would use the audit in an actual prioritization discussion.

If users cannot distinguish this from a generic review summary, narrow the promise before adding integrations or agent features.
