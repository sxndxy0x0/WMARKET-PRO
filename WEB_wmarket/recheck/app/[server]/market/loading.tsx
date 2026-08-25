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

      <main className="mx-auto max-w-[1315px] px-3 pb-12 pt-4 sm:px-5 lg:px-0">
        <div className="mb-5 flex gap-2 overflow-hidden">
          {Array.from({ length: 9 }).map((_, i) => (
            <Pulse key={i} className="h-9 w-24 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="overflow-hidden rounded-[18px] border border-white/10 bg-[#0b0f1c]">
          <div className="border-b border-white/10 px-4 py-3 sm:px-5">
            <Pulse className="h-4 w-40" />
          </div>
          <div className="divide-y divide-white/10">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3.5 py-3 sm:px-4">
                <Pulse className="h-10 w-10 shrink-0 rounded-[9px]" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Pulse className="h-3.5 w-32" />
                  <Pulse className="h-2.5 w-16" />
                </div>
                <Pulse className="h-4 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
