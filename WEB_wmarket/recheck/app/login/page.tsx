'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { BrandLogo } from '@/components/BrandLogo';

export default function LoginPage() {
  const { signInWithGoogle } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      router.push('/');
    } catch (err) {
      // Cancelling the Google popup isn't a real error — don't show it.
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="anim-fade-up w-full max-w-sm text-center">
        <div className="mb-4 flex justify-center">
          <BrandLogo link={false} />
        </div>
        <h1 className="font-sans text-xl font-semibold text-slate-100">เข้าสู่ระบบ WMarket</h1>
        <p className="mt-1 font-sans text-sm text-slate-500">ติดตามรายการโปรดและแจ้งเตือนราคาของคุณ</p>

        <button
          type="button"
          onClick={handleClick}
          disabled={submitting}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white py-2.5 font-sans text-sm font-medium text-zinc-900 shadow-[0_0_20px_rgba(255,255,255,.06)] hover:bg-zinc-100 disabled:opacity-60"
        >
          <GoogleIcon />
          {submitting ? 'กำลังเข้าสู่ระบบ…' : 'ดำเนินการต่อด้วย Google'}
        </button>

        {error && <p className="mt-4 font-sans text-sm text-red-400">{error}</p>}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}
