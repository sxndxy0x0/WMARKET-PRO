'use client';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-slate-100">
        <h1 className="text-lg font-semibold">เกิดข้อผิดพลาด</h1>
        <p className="mt-2 text-sm text-slate-400">ลองโหลดหน้านี้ใหม่อีกครั้ง</p>
        <button type="button" onClick={() => reset()} className="mt-5 rounded-lg border border-cyan-400/30 px-4 py-2 text-sm text-cyan-300 hover:bg-cyan-400/10">ลองอีกครั้ง</button>
      </div>
    </main>
  );
}
