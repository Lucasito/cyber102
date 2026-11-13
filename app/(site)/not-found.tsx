import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-5xl font-semibold text-stone-500">404</p>
      <h1 className="mt-4 text-2xl font-semibold">Такой страницы нет</h1>
      <p className="mt-2 text-stone-500">Возможно, событие удалено из афиши или ссылка устарела.</p>
      <Link href="/" className="mt-6 inline-block rounded-full bg-stone-900 px-6 py-2.5 font-medium text-white hover:bg-stone-700">
        К афише
      </Link>
    </main>
  );
}
