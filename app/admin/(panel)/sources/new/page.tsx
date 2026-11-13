import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { SourceForm } from "@/components/admin/source-form";
import { requireAdmin } from "@/lib/server/admin";

export default async function NewSource() {
  await requireAdmin("MODERATOR");
  return (
    <>
      <p className="text-sm">
        <Link href="/admin/sources" className="text-stone-500 hover:underline">
          ← Источники
        </Link>
      </p>
      <PageTitle title="Новый источник" desc="После сохранения откроется карточка источника — там можно проверить его без записи и собрать." />
      <Section>
        <SourceForm />
      </Section>
    </>
  );
}
