import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { PageHeader } from "@/components/workspace/ui-bits";
import { KnowledgeManager } from "@/components/workspace/KnowledgeManager";

export const Route = createFileRoute("/styles")({
  head: pageHead("أساليب الرد", "Reply styles and response examples the agent imitates."),
  component: () => (
    <>
      <PageHeader title="أساليب الرد والأمثلة" desc="عرّف نبرة الردود وأضف أمثلة حقيقية يتعلم منها الوكيل." />
      <KnowledgeManager categories={["style", "example"]} />
    </>
  ),
});
