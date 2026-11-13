/** Карточка страниц входа, восстановления и нового пароля. */
export function AuthCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f7f6f3] px-4">
      <main className="w-full max-w-sm rounded-3xl bg-white p-6 ring-1 ring-black/5 sm:p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        {desc && <p className="mt-1 text-sm text-stone-500">{desc}</p>}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}
