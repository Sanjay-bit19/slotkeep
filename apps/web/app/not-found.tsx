import Link from "next/link";

export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center"
    >
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="mt-2 text-slate-700">
        The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Link href="/" className="mt-6 text-indigo-700 underline">
        Go home
      </Link>
    </main>
  );
}
