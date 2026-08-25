function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/[0.05] ${className}`} />;
}

export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-30 border-b border-white/10 bg-[#070a13]/95">
        <div className="mx-auto flex h-[68px] max-w-[1315px] items-center gap-2.5 px-3 sm:px-5">
          <Pulse className="h-9 w-9 shrink-0" />
          <Pulse className="hidden h-5 w-32 sm:block" />
          <Pulse className="ml-auto h-11 w-full max-w-[430px]" />
          <Pulse className="ml-1 h-9 w-9 shrink-0 rounded-full" />
        </div>
      </div>

      <main className="flex-1 px-6 py-8">
        <Pulse className="mb-1 h-7 w-56" />
        <Pulse className="mb-6 h-4 w-80" />
        <div className="mb-6 flex flex-wrap gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Pulse key={i} className="h-8 w-28 rounded-lg" />
          ))}
        </div>
        <div className="flex flex-col gap-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-[#0b0f1c] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Pulse className="h-10 w-10 rounded-lg" />
                <Pulse className="h-4 w-40" />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Pulse key={j} className="h-8 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
