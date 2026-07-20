export default function Loading() {
  return (
    <main className="flex-1 px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-6xl gap-4">
        <div className="h-8 w-48 animate-pulse bg-muted" />
        <div className="h-24 max-w-3xl animate-pulse bg-muted" />
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="h-96 animate-pulse bg-muted" />
          <div className="grid gap-4">
            <div className="h-44 animate-pulse bg-muted" />
            <div className="h-44 animate-pulse bg-muted" />
          </div>
        </div>
      </div>
    </main>
  );
}
