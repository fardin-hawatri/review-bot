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
// This does nothing Slack-related — it's purely to keep the process awake on free hosting.
const keepAlive = express();
keepAlive.get('/', (_req, res) => res.status(200).send('Review Queue Bot is alive.'));
keepAlive.listen(process.env.PORT || 3000, () => {
  console.log(`Keep-alive server listening on port ${process.env.PORT || 3000}`);
});

// ---- /queue : show my current assigned count + list ----
app.command('/queue', async ({ command, ack, respond }) => {
  await ack();
  const items = store.getOpenQueueForUser(command.user_id);

  if (items.length === 0) {
    await respond({
      response_type: 'ephemeral',
      text: "You're all caught up — nothing in your queue right now. 🎉",
    });
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

// ---- Message shortcut: "Add to Review Queue" ----
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
          label: { type: 'plain_text', text: 'Assign to' },
          element: {
            type: 'users_select',
            action_id: 'assignee_select',
            placeholder: { type: 'plain_text', text: 'Select a reviewer' },
          },
        },
        {
          type: 'input',
          block_id: 'note_block',
          optional: true,
          label: { type: 'plain_text', text: 'Note (optional)' },
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

// ---- Handle modal submission: create the queue item + post thread reply ----
app.view('add_to_queue_submit', async ({ ack, body, view, client }) => {
  await ack();
  const meta = JSON.parse(view.private_metadata);
  const assigneeId = view.state.values.assignee_block.assignee_select.selected_user;
  const note = view.state.values.note_block.note_input.value || '';
  const addedBy = body.user.id;

  const item = store.addItem({
    assigneeId,
    channelId: meta.channelId,
    messageTs: meta.messageTs,
    note,
    addedBy,
  });

  const queueCount = store.getOpenQueueForUser(assigneeId).length;

  await client.chat.postMessage({
    channel: meta.channelId,
    thread_ts: meta.messageTs,
    text: `Assigned to <@${assigneeId}>${note ? ` — ${note}` : ''}. They now have ${queueCount} item${queueCount === 1 ? '' : 's'} in their queue.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📥 Assigned to <@${assigneeId}>${note ? ` — _${note}_` : ''}\nThey now have *${queueCount}* item${queueCount === 1 ? '' : 's'} in their queue.`,
        },
      },
      {
        type: 'actions',
        block_id: `queue_actions_${item.id}`,
        elements: [
          {
            type: 'button',
            action_id: 'close_item',
            text: { type: 'plain_text', text: '✅ Mark Done' },
            style: 'primary',
            value: String(item.id),
          },
        ],
      },
    ],
  });
});

// ---- Handle "Mark Done" button click: close item + edit the thread message ----
app.action('close_item', async ({ ack, body, client, action }) => {
  await ack();
  const itemId = Number(action.value);
  const closedBy = body.user.id;
  const item = store.closeItem(itemId, closedBy);
  if (!item) return;

  const remaining = store.getOpenQueueForUser(item.assigneeId).length;

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `✅ Closed by <@${closedBy}>. <@${item.assigneeId}> now has ${remaining} item${remaining === 1 ? '' : 's'} left.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Closed* by <@${closedBy}>${item.note ? ` — _${item.note}_` : ''}\n<@${item.assigneeId}> now has *${remaining}* item${remaining === 1 ? '' : 's'} left in their queue.`,
        },
      },
    ],
  });
});

(async () => {
  await app.start();
  console.log('⚡️ Review Queue Bot is running (Socket Mode)');
})();
