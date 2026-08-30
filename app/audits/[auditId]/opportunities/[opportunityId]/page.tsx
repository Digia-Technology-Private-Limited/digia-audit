import { OpportunityDetail } from "../../../../../components/OpportunityDetail";

export default async function OpportunityPage({ params }: { params: Promise<{ auditId: string; opportunityId: string }> }) {
  const { auditId, opportunityId } = await params;
  return <OpportunityDetail auditRunId={auditId} opportunityId={opportunityId} />;
}
