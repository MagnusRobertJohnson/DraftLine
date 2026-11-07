import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail, escapeHtml } from '@/lib/email';

export type NotificationType = 'invites' | 'swaps' | 'draft_updates' | 'chat';

export interface NotifyPayload {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string; // app-relative path, e.g. /drafts/abc/standings
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

// Creates an in-app notification for each user, then sends push (Expo) and email
// according to each user's saved preferences. Never throws.
export async function notifyUsers(userIds: string[], payload: NotifyPayload): Promise<void> {
  try {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return;

    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, email, notification_prefs')
      .in('id', ids);

    const recipients = (profiles ?? []).filter(
      (p: any) => (p.notification_prefs ?? {})[payload.type] !== false
    );
    if (recipients.length === 0) return;

    await supabaseAdmin.from('notifications').insert(
      recipients.map((p: any) => ({
        user_id: p.id,
        type: payload.type,
        title: payload.title.slice(0, 120),
        body: payload.body?.slice(0, 300) ?? null,
        link: payload.link ?? null,
      }))
    );

    const pushIds = recipients.filter((p: any) => p.notification_prefs?.push !== false).map((p: any) => p.id);
    if (pushIds.length > 0) {
      const { data: tokens } = await supabaseAdmin.from('push_tokens').select('token').in('user_id', pushIds);
      const messages = (tokens ?? []).map((t: any) => ({
        to: t.token,
        title: payload.title,
        body: payload.body ?? '',
        data: { link: payload.link ?? null },
      }));
      for (let i = 0; i < messages.length; i += 100) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messages.slice(i, i + 100)),
        }).catch(() => {});
      }
    }

    for (const p of recipients.filter((r: any) => r.notification_prefs?.email === true)) {
      const url = payload.link ? `${appUrl()}${payload.link}` : appUrl();
      await sendEmail(
        p.email,
        payload.title,
        `<p>${escapeHtml(payload.title)}</p><p>${escapeHtml(payload.body ?? '')}</p><p><a href="${url}">Open DraftLine</a></p>`
      );
    }
  } catch (err) {
    console.error('notifyUsers failed', err);
  }
}

// Everyone involved in a draft: its admin plus all team owners.
export async function getDraftParticipantIds(draftId: string): Promise<string[]> {
  const [{ data: draft }, { data: teams }] = await Promise.all([
    supabaseAdmin.from('drafts').select('admin_id').eq('id', draftId).maybeSingle(),
    supabaseAdmin.from('draft_teams').select('user_id').eq('draft_id', draftId),
  ]);
  return [draft?.admin_id, ...(teams ?? []).map((t: any) => t.user_id)].filter(Boolean) as string[];
}
