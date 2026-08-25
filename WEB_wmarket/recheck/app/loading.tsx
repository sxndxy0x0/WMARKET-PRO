function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/[0.05] ${className}`} />;
}

export default function Loading() {
  return (
    <div className="min-h-screen">
      {/* Topbar skeleton */}
      <div className="sticky top-0 z-30 border-b border-white/10 bg-[#070a13]/95">
        <div className="mx-auto flex h-[68px] max-w-[1315px] items-center gap-2.5 px-3 sm:px-5">
          <Pulse className="h-9 w-9 shrink-0" />
          <Pulse className="hidden h-5 w-32 sm:block" />
          <Pulse className="ml-auto h-11 w-full max-w-[430px]" />
          <Pulse className="ml-1 h-9 w-9 shrink-0 rounded-full" />
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1315px] px-3 pb-14 pt-5 sm:px-5 lg:px-0">
        {/* Trending strip skeleton */}
        <div className="mb-5">
          <Pulse className="mb-2 h-4 w-40" />
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <Pulse key={i} className="h-[104px] min-w-[286px] shrink-0 rounded-2xl sm:min-w-[300px]" />
            ))}
          </div>
        </div>

        {/* Summary cards skeleton */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Pulse key={i} className="h-[84px] rounded-2xl" />
          ))}
        </div>

        {/* Filter chips skeleton */}
        <div className="mb-4 flex gap-2 overflow-hidden">
          {Array.from({ length: 9 }).map((_, i) => (
            <Pulse key={i} className="h-9 w-24 shrink-0 rounded-full" />
          ))}
        </div>

        {/* Table skeleton */}
        <div className="overflow-hidden rounded-[20px] border border-white/10 bg-[#0b0f1c]">
          <div className="border-b border-white/10 px-4 py-4 sm:px-5">
            <Pulse className="h-9 w-64" />
          </div>
          <div className="divide-y divide-white/10">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3.5 py-3 sm:px-4">
                <Pulse className="h-10 w-10 shrink-0 rounded-[9px]" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Pulse className="h-3.5 w-32" />
                  <Pulse className="h-2.5 w-16" />
                </div>
                <Pulse className="h-4 w-16 shrink-0" />
                <Pulse className="hidden h-8 w-16 shrink-0 sm:block" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
