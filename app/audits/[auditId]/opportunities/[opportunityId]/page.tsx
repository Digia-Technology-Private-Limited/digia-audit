import { OpportunityDetail } from "../../../../../components/OpportunityDetail";

export default async function OpportunityPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  return <OpportunityDetail opportunityId={opportunityId} />;
}
