import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { PageHeader } from "@/components/workspace/ui-bits";
import { KnowledgeManager } from "@/components/workspace/KnowledgeManager";

export const Route = createFileRoute("/knowledge")({
  head: pageHead("المعرفة والذاكرة", "Create, search, categorize and version personal knowledge and instructions."),
  component: () => (
    <>
      <PageHeader title="المعرفة والذاكرة" desc="معلوماتك وتعليماتك للوكيل. كل تعديل يحفظ إصداراً جديداً. التخزين محلي في هذا المتصفح (المرحلة 1)." />
      <KnowledgeManager categories={["personal", "instruction", "style", "example"]} />
    </>
  ),
});
