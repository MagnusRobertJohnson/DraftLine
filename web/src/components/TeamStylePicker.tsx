'use client';

import { useState } from 'react';
import { authHeaders } from '@/lib/clientAuth';
import { TEAM_COLORS, TEAM_ICONS } from '@shared/team-style';

export default function TeamStylePicker({
  draftId,
  initialColor,
  initialIcon,
}: {
  draftId: string;
  initialColor: string | null;
  initialIcon: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState<string | null>(initialColor);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [msg, setMsg] = useState('');

  const save = async (c: string | null, i: string | null) => {
    setColor(c);
    setIcon(i);
    const res = await fetch(`/api/drafts/${draftId}/team-style`, {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify({ color: c, icon: i }),
    });
    setMsg(res.ok ? 'Saved' : (await res.json()).error);
  };

  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="text-xs text-ice-300 hover:underline">
        🎨 Customize team look
      </button>
      {open && (
        <div className="mt-2 space-y-2 bg-rink-dark border border-rink-border rounded-lg p-3">
          <div className="flex flex-wrap gap-1.5">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => save(c, icon)}
                style={{ backgroundColor: c }}
                className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEAM_ICONS.map((i) => (
              <button
                key={i}
                onClick={() => save(color, i)}
                className={`w-8 h-8 rounded text-lg border ${icon === i ? 'border-ice-400 bg-ice-900/40' : 'border-rink-border'}`}
              >
                {i}
              </button>
            ))}
          </div>
          {msg && <p className="text-[10px] text-slate-400">{msg}</p>}
        </div>
      )}
    </div>
  );
}
