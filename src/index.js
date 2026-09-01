require('dotenv').config();
const { App } = require('@slack/bolt');
const express = require('express');
const store = require('./store');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Tiny keep-alive server so free hosts (like Render) see this as a "web service"
// and an external pinger (e.g. UptimeRobot, free) can stop it from sleeping.
const keepAlive = express();
keepAlive.get('/', (_req, res) => res.status(200).send('Review Queue Bot is alive.'));
keepAlive.listen(process.env.PORT || 3000, () => {
  console.log(`Keep-alive server listening on port ${process.env.PORT || 3000}`);
});

// ---- Shared helper: build one Block Kit section (with its own Mark Done button) per assignee ----
function buildAssigneeSection(item, assigneeId, note, queueCount) {
  return {
    type: 'section',
    block_id: `queue_actions_${item.id}`,
    text: {
      type: 'mrkdwn',
      text: `📥 <@${assigneeId}>${note ? ` — _${note}_` : ''}\nNow has *${queueCount}* item${queueCount === 1 ? '' : 's'} in queue.`,
    },
    accessory: {
      type: 'button',
      action_id: 'close_item',
      text: { type: 'plain_text', text: '✅ Mark Done' },
      style: 'primary',
      value: String(item.id),
    },
  };
}

// ---- Shared helper: create one queue item per assignee + post the confirmation blocks ----
async function assignAndPost({ client, channelId, threadTs, assigneeIds, note, addedBy, headerText }) {
  const sections = [];
  for (const assigneeId of assigneeIds) {
    const item = store.addItem({ assigneeId, channelId, messageTs: threadTs, note, addedBy });
    const queueCount = store.getOpenQueueForUser(assigneeId).length;
    sections.push(buildAssigneeSection(item, assigneeId, note, queueCount));
  }

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `${headerText} ${assigneeIds.map((id) => `<@${id}>`).join(', ')}`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${headerText}*` } }, ...sections],
  });
}

// ---- Fetch all non-bot, non-deleted members of a channel ----
async function getChannelHumanMembers(client, channelId, excludeUserId) {
  const result = await client.conversations.members({ channel: channelId });
  const memberIds = result.members || [];
  const humans = [];
  for (const id of memberIds) {
    if (id === excludeUserId) continue;
    try {
      const info = await client.users.info({ user: id });
      if (!info.user.is_bot && !info.user.deleted) humans.push(id);
    } catch (e) {
      // skip users we can't look up
    }
  }
  return humans;
}

// ---- Only messages containing this trigger count as a review assignment ----
const TRIGGER_PATTERN = /(^|\s)[!/]review\b/i;

// ---- Pull the task name out of "!review TaskName @Name" (everything between the trigger and the first mention) ----
function extractTaskName(text) {
  const triggerMatch = (text || '').match(/[!/]review\b/i);
  if (!triggerMatch) return '';
  const afterTrigger = text.slice(triggerMatch.index + triggerMatch[0].length);
  const mentionIndex = afterTrigger.search(/<@[A-Z0-9]+>/);
  const raw = mentionIndex === -1 ? afterTrigger : afterTrigger.slice(0, mentionIndex);
  return raw.trim();
}

// ---- /queue : show my current assigned count + list ----
app.command('/queue', async ({ command, ack, respond }) => {
  await ack();
  const items = store.getOpenQueueForUser(command.user_id);

  if (items.length === 0) {
    await respond({ response_type: 'ephemeral', text: "You're all caught up — nothing in your queue right now. 🎉" });
    return;
  }

  const lines = items
    .map((item, i) => {
      const link = `https://slack.com/archives/${item.channelId}/p${item.messageTs.replace('.', '')}`;
      const dateStr = new Date(item.createdAt).toLocaleDateString();
      return `${i + 1}. <${link}|View item>${item.note ? ` — ${item.note}` : ''}  _(added ${dateStr})_`;
    })
    .join('\n');

  await respond({
    response_type: 'ephemeral',
    text: `You have *${items.length}* item${items.length === 1 ? '' : 's'} in your queue:\n${lines}`,
  });
});

// ---- /queue-team : show everyone's open count, visible only to whoever runs it ----
app.command('/queue-team', async ({ command, ack, respond }) => {
  await ack();
  const grouped = store.getAllOpenGroupedByAssignee();
  const entries = Object.entries(grouped);

  if (entries.length === 0) {
    await respond({ response_type: 'ephemeral', text: 'Nobody has anything in their queue right now. 🎉' });
    return;
  }

  entries.sort((a, b) => b[1] - a[1]); // most pending first
  const lines = entries.map(([userId, count]) => `• <@${userId}> — *${count}* item${count === 1 ? '' : 's'}`).join('\n');

  await respond({
    response_type: 'ephemeral', // only visible to the person who ran the command
    text: `*Team review queue:*\n${lines}`,
  });
});

// ---- Message shortcut: "Add to Review Queue" (manual, supports multiple people + whole channel) ----
app.shortcut('add_to_queue', async ({ shortcut, ack, client }) => {
  await ack();
  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'add_to_queue_submit',
      private_metadata: JSON.stringify({
        channelId: shortcut.channel.id,
        messageTs: shortcut.message.ts,
      }),
      title: { type: 'plain_text', text: 'Add to Review Queue' },
      submit: { type: 'plain_text', text: 'Assign' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'assignee_block',
          optional: true,
          label: { type: 'plain_text', text: 'Assign to (pick one or more)' },
          element: {
            type: 'multi_users_select',
            action_id: 'assignee_select',
            placeholder: { type: 'plain_text', text: 'Select reviewers' },
          },
        },
        {
          type: 'input',
          block_id: 'whole_channel_block',
          optional: true,
          label: { type: 'plain_text', text: 'Or skip the picker above and use:' },
          element: {
            type: 'checkboxes',
            action_id: 'whole_channel_checkbox',
            options: [{ text: { type: 'plain_text', text: 'Assign to everyone in this channel' }, value: 'whole_channel' }],
          },
        },
        {
          type: 'input',
          block_id: 'note_block',
          optional: true,
          label: { type: 'plain_text', text: 'Task name / note (optional)' },
          element: {
            type: 'plain_text_input',
            action_id: 'note_input',
            placeholder: { type: 'plain_text', text: 'e.g. Reel 3 — Hindi' },
          },
        },
      ],
    },
  });
});

// ---- Handle modal submission ----
app.view('add_to_queue_submit', async ({ ack, body, view, client }) => {
  const meta = JSON.parse(view.private_metadata);
  const selectedUsers = view.state.values.assignee_block.assignee_select.selected_users || [];
  const wholeChannel = (view.state.values.whole_channel_block.whole_channel_checkbox.selected_options || []).length > 0;
  const note = view.state.values.note_block.note_input.value || '';
  const addedBy = body.user.id;

  if (selectedUsers.length === 0 && !wholeChannel) {
    await ack({
      response_action: 'errors',
      errors: { assignee_block: 'Pick at least one person, or check "assign to everyone in this channel".' },
    });
    return;
  }
  await ack();

  let assigneeIds = selectedUsers;
  if (wholeChannel) {
    assigneeIds = await getChannelHumanMembers(client, meta.channelId, addedBy);
  }
  assigneeIds = [...new Set(assigneeIds)]; // dedupe

  await assignAndPost({
    client,
    channelId: meta.channelId,
    threadTs: meta.messageTs,
    assigneeIds,
    note,
    addedBy,
    headerText: 'Assigned to',
  });
});

// ---- Auto-detect "!review TaskName @name" (or "/review TaskName @name") and add to that person's queue ----
app.event('message', async ({ event, client, context }) => {
  console.log('[message event received]', { text: event.text, subtype: event.subtype, channel: event.channel, botUserId: context.botUserId });
  if (event.subtype) return; // skip edits, deletes, joins, bot messages, etc.
  if (event.bot_id) return;
  if (!TRIGGER_PATTERN.test(event.text || '')) return; // ignore plain chat — only explicit !review counts

  const note = extractTaskName(event.text || '');

  const mentionPattern = /<@([A-Z0-9]+)>/g;
  const mentioned = new Set();
  let match;
  while ((match = mentionPattern.exec(event.text || '')) !== null) {
    const userId = match[1];
    if (userId === event.user) continue; // skip self-mentions
    if (userId === context.botUserId) continue; // skip mentioning the bot itself
    mentioned.add(userId);
  }
  if (mentioned.size === 0) return;

  await assignAndPost({
    client,
    channelId: event.channel,
    threadTs: event.thread_ts || event.ts,
    assigneeIds: [...mentioned],
    note,
    addedBy: event.user,
    headerText: 'Assigned (via !review) to',
  });
});

// ---- Handle "Mark Done" button click ----
app.action('close_item', async ({ ack, body, client, action }) => {
  await ack();
  const itemId = Number(action.value);
  const closedBy = body.user.id;
  const item = store.closeItem(itemId, closedBy);
  if (!item) return;

  const remaining = store.getOpenQueueForUser(item.assigneeId).length;

  // Update just this assignee's section within the message, leaving other assignees' sections untouched
  const blocks = body.message.blocks.map((block) => {
    if (block.block_id === `queue_actions_${item.id}`) {
      return {
        type: 'section',
        block_id: block.block_id,
        text: {
          type: 'mrkdwn',
          text: `✅ *Closed* by <@${closedBy}> — <@${item.assigneeId}>${item.note ? ` — _${item.note}_` : ''}\nNow has *${remaining}* left.`,
        },
      };
    }
    return block;
  });

  await client.chat.update({ channel: body.channel.id, ts: body.message.ts, text: 'Item closed.', blocks });
});

(async () => {
  await app.start();
  console.log('⚡️ Review Queue Bot is running (Socket Mode)');
})();
