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

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Pulse className="mb-4 h-4 w-32" />
        <div className="flex items-center gap-2">
          <Pulse className="h-6 w-6 rounded-full" />
          <Pulse className="h-8 w-56" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Pulse key={i} className="h-[76px] rounded-xl" />
          ))}
        </div>
        <Pulse className="mt-4 h-72 rounded-2xl" />
      </main>
    </div>
  );
}
