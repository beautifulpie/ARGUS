import { FormEvent, useEffect, useState } from 'react';
import { Settings } from 'lucide-react';

interface DeveloperAccessDialogProps {
  open: boolean;
  pending: boolean;
  errorMessage: string | null;
  mapTheme: 'DARK' | 'LIGHT';
  onClose: () => void;
  onSubmit: (payload: { id: string; password: string }) => void;
}

export function DeveloperAccessDialog({
  open,
  pending,
  errorMessage,
  mapTheme,
  onClose,
  onSubmit,
}: DeveloperAccessDialogProps) {
  const [idValue, setIdValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');

  useEffect(() => {
    if (!open) return;
    setIdValue('');
    setPasswordValue('');
  }, [open]);

  if (!open) return null;

  const isLightTheme = mapTheme === 'LIGHT';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      id: idValue.trim(),
      password: passwordValue,
    });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 px-4">
      <div
        className={`w-full max-w-[420px] rounded border p-5 shadow-2xl ${
          isLightTheme
            ? 'border-slate-300 bg-slate-50 text-slate-900'
            : 'border-cyan-900/65 bg-[#0b141d] text-slate-100'
        }`}
      >
        <h2 className="inline-flex items-center gap-1.5 text-lg font-bold tracking-[0.02em]">
          <span>Developer Setting</span>
          <Settings className={`h-4 w-4 ${isLightTheme ? 'text-slate-600' : 'text-cyan-300/90'}`} />
        </h2>
        <p className={`mt-1 text-sm ${isLightTheme ? 'text-slate-600' : 'text-slate-400'}`}>
          비인가 된 사용자의 접근을 허용 하지 않습니다.
        </p>

        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <label className="block">
            <span className={`mb-1 block text-xs font-semibold ${isLightTheme ? 'text-slate-600' : 'text-slate-400'}`}>
              ID
            </span>
            <input
              type="text"
              value={idValue}
              onChange={(event) => setIdValue(event.target.value)}
              autoComplete="username"
              className={`h-10 w-full rounded border px-3 text-sm outline-none ${
                isLightTheme
                  ? 'border-slate-300 bg-white text-slate-900 focus:border-cyan-600'
                  : 'border-slate-700 bg-[#0f1b27] text-slate-100 focus:border-cyan-500'
              }`}
            />
          </label>

          <label className="block">
            <span className={`mb-1 block text-xs font-semibold ${isLightTheme ? 'text-slate-600' : 'text-slate-400'}`}>
              PW
            </span>
            <input
              type="password"
              value={passwordValue}
              onChange={(event) => setPasswordValue(event.target.value)}
              autoComplete="current-password"
              className={`h-10 w-full rounded border px-3 text-sm outline-none ${
                isLightTheme
                  ? 'border-slate-300 bg-white text-slate-900 focus:border-cyan-600'
                  : 'border-slate-700 bg-[#0f1b27] text-slate-100 focus:border-cyan-500'
              }`}
            />
          </label>

          {errorMessage && (
            <p className={`text-sm font-medium ${isLightTheme ? 'text-red-700' : 'text-red-300'}`}>
              {errorMessage}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`h-9 rounded border px-3 text-sm font-semibold ${
                isLightTheme
                  ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  : 'border-slate-600 bg-[#111a24] text-slate-200 hover:bg-[#1a2836]'
              }`}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={pending}
              className={`h-9 rounded border px-3 text-sm font-semibold ${
                isLightTheme
                  ? 'border-cyan-700 bg-cyan-100 text-cyan-900 hover:bg-cyan-200'
                  : 'border-cyan-600 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-900/45'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {pending ? '확인 중...' : '인증'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
