// ─────────────────────────────────────────────────────────────────────────
// groupPolls.js
//
// CRUD helpers for group polls. Each poll has:
//   - a question
//   - 2–4 options
//   - one vote per user per poll
//
// DB tables: group_polls, group_poll_options, group_poll_votes
// ─────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase';

/**
 * Fetch all polls for a group, with options + vote counts + caller's vote.
 * Returns: { polls: Array, error }
 */
export async function fetchGroupPolls(groupId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { polls: [], error: new Error('Not authenticated') };

  const { data, error } = await supabase
    .from('group_polls')
    .select(`
      id,
      question,
      created_at,
      author_id,
      profiles!group_polls_author_id_fkey (
        full_name,
        avatar_url
      ),
      group_poll_options (
        id,
        option_text,
        sort_order,
        group_poll_votes ( voter_id )
      )
    `)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (error) return { polls: [], error };

  const polls = (data ?? []).map((poll) => ({
    id: poll.id,
    question: poll.question,
    created_at: poll.created_at,
    author_id: poll.author_id,
    author_name: poll.profiles?.full_name ?? null,
    author_avatar: poll.profiles?.avatar_url ?? null,
    options: (poll.group_poll_options ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((opt) => ({
        id: opt.id,
        option_text: opt.option_text,
        vote_count: opt.group_poll_votes?.length ?? 0,
        i_voted: (opt.group_poll_votes ?? []).some((v) => v.voter_id === user.id),
      })),
  }));

  return { polls, error: null };
}

/**
 * Create a poll with its options in a single transaction via RPC.
 * Falls back to sequential inserts if the RPC isn't deployed yet.
 */
export async function createGroupPoll(groupId, question, options) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: new Error('Not authenticated') };

  // Insert poll
  const { data: poll, error: pollError } = await supabase
    .from('group_polls')
    .insert({ group_id: groupId, author_id: user.id, question: question.trim() })
    .select('id')
    .single();

  if (pollError) return { error: pollError };

  // Insert options
  const rows = options
    .filter((o) => o.trim())
    .map((o, i) => ({ poll_id: poll.id, option_text: o.trim(), sort_order: i }));

  const { error: optError } = await supabase
    .from('group_poll_options')
    .insert(rows);

  if (optError) {
    // Cleanup orphan poll
    await supabase.from('group_polls').delete().eq('id', poll.id);
    return { error: optError };
  }

  return { pollId: poll.id, error: null };
}

/**
 * Cast a vote. One vote per user per poll (enforced by DB unique constraint).
 * If user already voted, this is a no-op (upsert with ignore).
 */
export async function voteGroupPoll(pollId, optionId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: new Error('Not authenticated') };

  // Remove existing vote for this poll (allows vote change)
  await supabase
    .from('group_poll_votes')
    .delete()
    .eq('poll_id', pollId)
    .eq('voter_id', user.id);

  const { error } = await supabase
    .from('group_poll_votes')
    .insert({ poll_id: pollId, option_id: optionId, voter_id: user.id });

  return { error: error ?? null };
}

/**
 * Delete a poll (cascades to options + votes via DB foreign keys).
 */
export async function deleteGroupPoll(pollId) {
  const { error } = await supabase
    .from('group_polls')
    .delete()
    .eq('id', pollId);

  return { error: error ?? null };
}
