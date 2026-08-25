'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Bell, Trash2, CheckCircle2, BellRing } from 'lucide-react';
import { RequireAuth } from '@/components/RequireAuth';
import { Topbar } from '@/components/Topbar';
import { EmptyState, Skeleton } from '@/components/motion';
import * as api from '@/lib/api';
import { serverIdentityKey, fetchServers, decodeServerSegment, type PriceAlert } from '@/lib/api';
import { formatCoinValue, formatRelativeTime } from '@/lib/format';


function AlertsBody() {
  const searchParams = useSearchParams();
  const params = useParams<{ server: string }>();
  const requestedParam = decodeServerSegment(params.server || '');
  const [serverName, setServerName] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const SERVER = serverName ?? '';

  // Reset resolution state when the route param changes — during render
  // (React's "adjust state on prop change" pattern), not inside the effect.
  const [prevParam, setPrevParam] = useState(requestedParam);
  if (prevParam !== requestedParam) {
    setPrevParam(requestedParam);
    setServerName(null);
    setServerStatus('loading');
  }

  useEffect(() => {
    let active = true;
    fetchServers().then((servers) => {
      if (!active) return;
      const canonical = servers.find((entry) => serverIdentityKey(entry.name) === serverIdentityKey(requestedParam))?.name;
      if (canonical) {
        setServerName(canonical);
        setServerStatus('ready');
      } else {
        setServerStatus('invalid');
      }
    }).catch(() => {
      if (active) {
        setServerName(null);
        setServerStatus('error');
      }
    });
    return () => { active = false; };
  }, [requestedParam]);
  const [alerts, setAlerts] = useState<PriceAlert[] | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serverAlerts = SERVER ? (alerts?.filter((alert) => serverIdentityKey(alert.server) === serverIdentityKey(SERVER)) ?? null) : null;

  // Prefilled when arriving from an item page's "ตั้งค่าแจ้งเตือน" link
  // (/alerts?itemId=...&itemName=...). URL changes are adopted during render
  // (React's adjust-state-on-change pattern) instead of via a sync effect.
  const searchItemId = searchParams.get('itemId') ?? '';
  const searchItemName = searchParams.get('itemName') ?? '';
  const [itemId, setItemId] = useState(searchItemId);
  const [itemName, setItemName] = useState(searchItemName);
  const [prefill, setPrefill] = useState({ itemId: searchItemId, itemName: searchItemName });
  if (prefill.itemId !== searchItemId || prefill.itemName !== searchItemName) {
    setPrefill({ itemId: searchItemId, itemName: searchItemName });
    setItemId(searchItemId);
    setItemName(searchItemName);
  }
  const [thresholdType, setThresholdType] = useState<'above' | 'below'>('above');
  const [thresholdValue, setThresholdValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(() => {
    setAlertsLoading(true);
    setAlertsError(null);
    api
      .fetchAlerts()
      .then((next) => {
        setAlerts(next);
        setAlertsError(null);
      })
      .catch((err) => {
        setAlertsError(err instanceof Error ? err.message : 'โหลดรายการแจ้งเตือนไม่สำเร็จ');
      })
      .finally(() => setAlertsLoading(false));
  }, []);

  useEffect(() => {
    if (!SERVER) return;
    // refresh() writes loading state synchronously; deferring by a microtask
    // keeps that write out of the effect body (react-hooks/set-state-in-effect)
    // while preserving identical behavior.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) refresh();
    });
    return () => { cancelled = true; };
  }, [refresh, SERVER]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const value = Number(thresholdValue);
    if (!SERVER) {
      setError('ไม่พบเซิร์ฟเวอร์นี้ใน Backend');
      return;
    }
    if (!itemId.trim() || !itemName.trim() || !Number.isFinite(value) || value < 0) {
      setError('กรอกรหัสสินค้า ชื่อ และเกณฑ์ราคาที่ถูกต้อง (ไม่ติดลบ)');
      return;
    }

    setSubmitting(true);
    try {
      await api.createAlert({
        server: SERVER,
        itemId: itemId.trim(),
        itemName: itemName.trim(),
        thresholdType,
        thresholdValue: value,
      });
      setItemId('');
      setItemName('');
      setThresholdValue('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สร้างการแจ้งเตือนไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setAlerts((prev) => prev?.filter((a) => a.id !== id) ?? null);
    try {
      await api.deleteAlert(id);
    } catch {
      refresh();
    }
  }

  return (
    <>
      <Topbar server={SERVER} />
      <main className="flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 font-sans text-2xl font-semibold text-slate-100">
            <Bell size={22} className="text-cyan-300" />
            แจ้งเตือนราคา
          </h1>
          <p className="mt-1 font-sans text-sm text-slate-500">
            รับแจ้งเตือนเมื่อราคาขายของสินค้าข้ามเกณฑ์ที่ตั้งไว้บน {SERVER}
          </p>
        </div>

        {serverStatus === 'loading' ? (
          <p className="mb-6 font-sans text-sm text-slate-500">กำลังตรวจสอบเซิร์ฟเวอร์…</p>
        ) : serverStatus === 'error' ? (
          <div className="mb-6 rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-6 text-center">
            <p className="font-sans text-sm font-medium text-slate-100">ตรวจสอบเซิร์ฟเวอร์ไม่สำเร็จ</p>
            <p className="mt-1 font-sans text-sm text-slate-500">ไม่สามารถโหลดรายการเซิร์ฟเวอร์จาก Backend ได้</p>
            <Link href="/" className="mt-4 inline-block rounded-lg bg-cyan-400 px-4 py-2 font-sans text-sm font-semibold text-[#050810] hover:bg-cyan-300">
              กลับไปเลือกเซิร์ฟเวอร์
            </Link>
          </div>
        ) : serverStatus === 'invalid' ? (
          <div className="mb-6 rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-6 text-center">
            <p className="font-sans text-sm font-medium text-slate-100">ไม่พบเซิร์ฟเวอร์นี้ใน Backend</p>
            <p className="mt-1 font-sans text-sm text-slate-500">เซิร์ฟเวอร์อาจถูกถอดออกหรือชื่อใน URL ไม่ตรงกับรายการปัจจุบัน</p>
            <Link href="/" className="mt-4 inline-block rounded-lg bg-cyan-400 px-4 py-2 font-sans text-sm font-semibold text-[#050810] hover:bg-cyan-300">
              กลับไปเลือกเซิร์ฟเวอร์
            </Link>
          </div>
        ) : (
        <form
          onSubmit={handleCreate}
          className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-white/10 bg-[#0b0f1c] p-5 shadow-[0_10px_30px_rgba(0,0,0,.3)] sm:grid-cols-2 lg:grid-cols-5"
        >
          <div className="lg:col-span-2">
            <label className="mb-1.5 block font-sans text-xs font-medium text-slate-300">
              รหัสสินค้า <span className="text-slate-500">(เช่น spawner)</span>
            </label>
            <input
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              placeholder="spawner"
              className="w-full rounded-lg border border-white/10 bg-[#0a0e18] px-3 py-2 font-sans text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="mb-1.5 block font-sans text-xs font-medium text-slate-300">ชื่อที่แสดง</label>
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="spawner"
              className="w-full rounded-lg border border-white/10 bg-[#0a0e18] px-3 py-2 font-sans text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
            />
          </div>
          <div>
            <label className="mb-1.5 block font-sans text-xs font-medium text-slate-300">เงื่อนไข</label>
            <select
              value={thresholdType}
              onChange={(e) => setThresholdType(e.target.value as 'above' | 'below')}
              className="w-full rounded-lg border border-white/10 bg-[#0a0e18] px-3 py-2 font-sans text-sm text-slate-100 outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30 [&>option]:bg-[#0a0e18]"
            >
              <option value="above">ขึ้นสูงกว่า</option>
              <option value="below">ลงต่ำกว่า</option>
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="mb-1.5 block font-sans text-xs font-medium text-slate-300">
              เกณฑ์ราคาขาย (฿)
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={thresholdValue}
              onChange={(e) => setThresholdValue(e.target.value)}
              placeholder="1000"
              className="w-full rounded-lg border border-white/10 bg-[#0a0e18] px-3 py-2 font-sans text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting || !SERVER}
              className="w-full rounded-lg bg-cyan-400 py-2.5 font-sans text-sm font-semibold text-[#050810] hover:bg-cyan-300 disabled:opacity-60"
            >
              {submitting ? 'กำลังสร้าง…' : 'สร้างการแจ้งเตือน'}
            </button>
          </div>
          {error && <p className="sm:col-span-2 lg:col-span-5 font-sans text-sm text-red-400">{error}</p>}
        </form>
        )}

        {serverStatus === 'loading' ? (
          <p className="font-sans text-sm text-slate-500">กำลังตรวจสอบเซิร์ฟเวอร์…</p>
        ) : serverStatus === 'error' ? (
          <p className="font-sans text-sm text-red-400">ไม่สามารถโหลดข้อมูลแจ้งเตือนได้ในขณะนี้</p>
        ) : serverStatus === 'invalid' ? (
          <p className="font-sans text-sm text-slate-500">ไม่มีข้อมูลแจ้งเตือนสำหรับเซิร์ฟเวอร์นี้</p>
        ) : alertsError ? (
          <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-6 text-center" role="alert">
            <p className="font-sans text-sm font-medium text-slate-100">โหลดข้อมูลแจ้งเตือนไม่สำเร็จ</p>
            <p className="mt-1 font-sans text-sm text-slate-500">{alertsError}</p>
            <button type="button" onClick={refresh} className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 font-sans text-sm font-semibold text-[#050810] hover:bg-cyan-300">ลองอีกครั้ง</button>
          </div>
        ) : alertsLoading || serverAlerts === null ? (
          <div className="space-y-2" aria-busy="true" aria-label="กำลังโหลดการแจ้งเตือน">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : serverAlerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02]">
            <EmptyState
              icon={<BellRing size={22} />}
              title="ยังไม่มีการแจ้งเตือน"
              hint="สร้างรายการด้านบนเพื่อรับแจ้งเตือนเมื่อราคาเปลี่ยน"
            />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#0b0f1c] shadow-[0_10px_30px_rgba(0,0,0,.3)]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-left font-sans text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-medium">สินค้า</th>
                  <th className="px-4 py-3 font-medium">เงื่อนไข</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                  <th className="px-4 py-3 font-medium">สร้างเมื่อ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {serverAlerts.map((alert, i) => (
                  <tr key={alert.id} style={{ ['--d' as string]: `${i * 45}ms` }} className="anim-fade-up border-b border-white/10 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-sans text-sm font-medium text-slate-100">
                      {alert.itemName}
                    </td>
                    <td className="px-4 py-3 font-sans text-sm text-slate-300">
                      {alert.thresholdType === 'above' ? '≥' : '≤'} {formatCoinValue(alert.thresholdValue)}
                    </td>
                    <td className="px-4 py-3">
                      {alert.triggeredAt ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 font-sans text-xs font-medium text-emerald-400">
                          <CheckCircle2 size={12} />
                          แจ้งเตือนแล้ว {formatRelativeTime(alert.triggeredAt)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-white/[0.04] px-2 py-0.5 font-sans text-xs font-medium text-slate-500">
                          กำลังติดตาม
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-sans text-xs text-slate-500">
                      {formatRelativeTime(alert.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(alert.id)}
                        aria-label="ลบการแจ้งเตือน"
                        className="rounded-md p-1.5 text-slate-500 hover:bg-red-400/10 hover:text-red-400"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

export default function AlertsPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p className="p-6 font-sans text-sm text-slate-500">กำลังโหลด…</p>}>
        <AlertsBody />
      </Suspense>
    </RequireAuth>
  );
}
