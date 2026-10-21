import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Call the database stored procedure to apply due roster transactions
    const { data, error } = await supabaseAdmin.rpc('apply_due_roster_transactions');

    if (error) {
      // Fallback: apply directly in TypeScript if RPC not registered
      const now = new Date().toISOString();
      const { data: pendingTx, error: txErr } = await supabaseAdmin
        .from('roster_transactions')
        .select('*, roster_transaction_players(*)')
        .eq('status', 'pending')
        .lte('effective_at', now);

      if (txErr) throw txErr;

      let appliedCount = 0;
      for (const tx of pendingTx || []) {
        for (const p of tx.roster_transaction_players || []) {
          await supabaseAdmin
            .from('draft_picks')
            .update({ roster_status: p.to_status })
            .eq('id', p.draft_pick_id);
        }
        await supabaseAdmin
          .from('roster_transactions')
          .update({ status: 'applied' })
          .eq('id', tx.id);
        appliedCount++;
      }

      return NextResponse.json({ success: true, count: appliedCount, fallback: true });
    }

    return NextResponse.json({ success: true, count: data });
  } catch (err: any) {
    console.error('Error applying roster transactions:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to apply roster transactions' },
      { status: 500 }
    );
  }
}
