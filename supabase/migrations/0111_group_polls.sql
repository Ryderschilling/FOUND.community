-- ─────────────────────────────────────────────────────────────────────────
-- 0111_group_polls.sql
--
-- Adds group poll tables: group_polls, group_poll_options, group_poll_votes
-- One vote per user per poll (unique constraint on poll_id + voter_id).
-- Cascades on group/poll delete.
--
-- NOTE: group_members has NO status column — every row is an active member.
-- ─────────────────────────────────────────────────────────────────────────

-- ── group_polls ────────────────────────────────────────────────────────────
create table if not exists group_polls (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references groups(id) on delete cascade,
  author_id  uuid        not null references profiles(id) on delete cascade,
  question   text        not null check(char_length(question) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists idx_group_polls_group on group_polls(group_id, created_at desc);

-- ── group_poll_options ──────────────────────────────────────────────────────
create table if not exists group_poll_options (
  id          uuid    primary key default gen_random_uuid(),
  poll_id     uuid    not null references group_polls(id) on delete cascade,
  option_text text    not null check(char_length(option_text) between 1 and 200),
  sort_order  integer not null default 0
);

create index if not exists idx_poll_options_poll on group_poll_options(poll_id, sort_order);

-- ── group_poll_votes ────────────────────────────────────────────────────────
create table if not exists group_poll_votes (
  id         uuid        primary key default gen_random_uuid(),
  poll_id    uuid        not null references group_polls(id) on delete cascade,
  option_id  uuid        not null references group_poll_options(id) on delete cascade,
  voter_id   uuid        not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(poll_id, voter_id)     -- one vote per user per poll
);

create index if not exists idx_poll_votes_poll    on group_poll_votes(poll_id);
create index if not exists idx_poll_votes_option  on group_poll_votes(option_id);
create index if not exists idx_poll_votes_voter   on group_poll_votes(voter_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table group_polls        enable row level security;
alter table group_poll_options enable row level security;
alter table group_poll_votes   enable row level security;

-- group_polls: any group member can read/insert; author or admin can delete
create policy "group members can view polls"
  on group_polls for select
  using (
    exists (
      select 1 from group_members
      where group_id = group_polls.group_id
        and profile_id = auth.uid()
    )
  );

create policy "group members can create polls"
  on group_polls for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from group_members
      where group_id = group_polls.group_id
        and profile_id = auth.uid()
    )
  );

create policy "author or admin can delete polls"
  on group_polls for delete
  using (
    author_id = auth.uid()
    or exists (
      select 1 from group_members
      where group_id = group_polls.group_id
        and profile_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );

-- group_poll_options: readable by group members; insertable by poll author
create policy "group members can view poll options"
  on group_poll_options for select
  using (
    exists (
      select 1 from group_polls gp
      join group_members gm on gm.group_id = gp.group_id
      where gp.id = group_poll_options.poll_id
        and gm.profile_id = auth.uid()
    )
  );

create policy "poll author can insert options"
  on group_poll_options for insert
  with check (
    exists (
      select 1 from group_polls
      where id = group_poll_options.poll_id
        and author_id = auth.uid()
    )
  );

create policy "cascade delete handles option deletion"
  on group_poll_options for delete
  using (
    exists (
      select 1 from group_polls
      where id = group_poll_options.poll_id
        and author_id = auth.uid()
    )
  );

-- group_poll_votes: group members can read & vote; voters can delete own vote
create policy "group members can view votes"
  on group_poll_votes for select
  using (
    exists (
      select 1 from group_polls gp
      join group_members gm on gm.group_id = gp.group_id
      where gp.id = group_poll_votes.poll_id
        and gm.profile_id = auth.uid()
    )
  );

create policy "group members can vote"
  on group_poll_votes for insert
  with check (
    voter_id = auth.uid()
    and exists (
      select 1 from group_polls gp
      join group_members gm on gm.group_id = gp.group_id
      where gp.id = group_poll_votes.poll_id
        and gm.profile_id = auth.uid()
    )
  );

create policy "voters can change their vote"
  on group_poll_votes for delete
  using (voter_id = auth.uid());
