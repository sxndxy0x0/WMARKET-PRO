import Link from 'next/link';
import { ArrowRight, Server, Sparkles } from 'lucide-react';
import { fetchServers, serverIdentityKey, serverPath, shortServerLabel } from '@/lib/api';
import { BrandLogo } from '@/components/BrandLogo';

export const revalidate = 15;

export default async function RootPage() {
  let servers: Awaited<ReturnType<typeof fetchServers>> = [];
  let serverLoadFailed = false;

  try {
    servers = await fetchServers();
  } catch {
    serverLoadFailed = true;
  }

  return (
    <main className="min-h-screen bg-[#070a13] text-slate-100">
      <header className="border-b border-white/10 bg-[#070a13]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-[1180px] items-center px-5 lg:px-0">
          <BrandLogo />
          <div className="ml-auto text-xs font-semibold text-slate-500">เลือกเซิร์ฟเวอร์</div>
        </div>
      </header>

      <section className="mx-auto max-w-[1180px] px-5 pb-16 pt-16 lg:px-0 lg:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 shadow-[0_0_30px_rgba(34,211,238,.12)]">
            <Sparkles size={22} />
          </div>
          <p className="mb-2 text-xs font-black uppercase tracking-[.22em] text-cyan-300/80">WMarket</p>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-5xl">
            เลือกเซิร์ฟเวอร์ที่ต้องการดู
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
            เลือกเซิร์ฟเวอร์ก่อนเพื่อดูราคาสินค้า สถิติ ตลาด และข้อมูลต่าง ๆ ของเซิร์ฟเวอร์นั้น
            โดยรายการนี้มาจากเซิร์ฟเวอร์ที่ Backend ได้รับจาก Mod เท่านั้น
          </p>
        </div>

        {serverLoadFailed ? (
          <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-red-400/30 bg-red-400/5 px-6 py-10 text-center" role="alert">
            <Server size={28} className="mx-auto text-red-300" />
            <h2 className="mt-4 text-lg font-bold text-slate-200">ไม่สามารถโหลดรายชื่อเซิร์ฟเวอร์ได้</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Backend อาจกำลังไม่พร้อมใช้งาน ลองรีเฟรชหน้านี้อีกครั้ง</p>
          </div>
        ) : servers.length > 0 ? (
          <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {servers.map((server) => (
              <Link
                key={serverIdentityKey(server.name)}
                href={serverPath(server.name)}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/30 hover:bg-white/[0.055] hover:shadow-[0_16px_45px_rgba(0,0,0,.28)] focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
              >
                <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-cyan-400/5 blur-2xl transition group-hover:bg-cyan-400/10" />
                <div className="relative flex items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-400/15 bg-emerald-400/10 text-emerald-300">
                    <Server size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-extrabold text-slate-100">{shortServerLabel(server.name)}</span>
                    <span className="mt-1 block text-xs font-semibold text-slate-500">ดูตลาดและราคาของเซิร์ฟเวอร์นี้</span>
                  </span>
                  <ArrowRight size={18} className="shrink-0 text-slate-600 transition group-hover:translate-x-1 group-hover:text-cyan-300" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-10 text-center">
            <Server size={28} className="mx-auto text-slate-600" />
            <h2 className="mt-4 text-lg font-bold text-slate-200">ยังไม่พบเซิร์ฟเวอร์</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              เว็บจะแสดงเฉพาะเซิร์ฟเวอร์ที่ Backend ได้รับข้อมูลจาก Mod แล้วเท่านั้น
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
