/** Route-level loading skeleton — shows instantly while the server
 * component fetches market data (covers cold backend wake-ups too). */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="กำลังโหลดข้อมูลตลาด">
      <div className="h-28 rounded-2xl border border-white/10 bg-white/[0.03]" />
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-20 rounded-full bg-white/[0.04]" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-white/10 p-3">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-white/[0.05]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-3/4 rounded bg-white/[0.06]" />
                <div className="h-2.5 w-1/2 rounded bg-white/[0.04]" />
              </div>
            </div>
            <div className="h-4 w-2/3 rounded bg-white/[0.05]" />
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-slate-500">กำลังโหลดข้อมูลตลาด… (ครั้งแรกหลังเซิร์ฟเวอร์หลับอาจใช้ ~30 วิ)</p>
    </div>
  );
}
