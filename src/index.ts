import * as core from '@actions/core'
import { App, BlockAction, LogLevel } from '@slack/bolt'
import { WebClient } from '@slack/web-api'
import { randomUUID } from 'crypto'

const token = process.env.SLACK_BOT_TOKEN || ""
const signingSecret =  process.env.SLACK_SIGNING_SECRET || ""
const slackAppToken = process.env.SLACK_APP_TOKEN || ""
const channel_id    = process.env.SLACK_CHANNEL_ID || ""
const environment   = process.env.ENVIRONMENT || ""
const url           = process.env.URL || ""
const approver      = process.env.APPROVER || ""
const approvers     = (process.env.APPROVERS || approver).split("::")
const requestReason = process.env.REQUEST_REASON || ""
const runport : any  = process.env.PORT || 3000
const acceptValue : any = `${randomUUID()}-approve`;
const rejectValue : any = `${randomUUID()}-reject`;

const app = new App({
  token: token,
  signingSecret: signingSecret,
  appToken: slackAppToken,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
});

var approvals_received : number = 0;

async function run(): Promise<void> {
  try {
    const web = new WebClient(token);

    const github_server_url = process.env.GITHUB_SERVER_URL || "";
    const github_repos      = process.env.GITHUB_REPOSITORY || "";
    const run_id            = process.env.GITHUB_RUN_ID || "";
    const actionsUrl        = `${github_server_url}/${github_repos}/actions/runs/${run_id}`;
    const workflow          = process.env.GITHUB_WORKFLOW || "";
    const actor             = process.env.GITHUB_ACTOR || "";

    (async () => {
      const result = await web.chat.postMessage({ 
        channel: channel_id, 
        text: "GitHub Actions Approval request",
        blocks: [
            {
              "type": "section",
              "text": {
                  "type": "mrkdwn",
                  "text": `GHA Approval Request for \`${requestReason}\` (Approval buttons are in thread)`
                }
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text": `*Triggering Actor:* ${actor}`
                },
                
                {
                  "type": "mrkdwn",
                  "text": `*Approving Actor(s):* ${approvers.join(" ")}`
                },
                
                {
                  "type": "mrkdwn",
                  "text": `*Branch:* ${environment}`
                },
                {
                  "type": "mrkdwn",
                  "text": `*Workflow:* <${actionsUrl}|${workflow}>`
                },
                {
                  "type": "mrkdwn",
                  "text": `*URL:* ${url}`
                }
              ]
            }
        ]
      });

      for(let i = 0; i < approvers.length; i++) {
        await web.chat.postMessage({ 
          channel: channel_id,
          thread_ts: result.ts,
          text: "GitHub Actions Approval request",
          blocks: [
              {
                "type": "section",
                "fields": [
                  {
                    "type": "mrkdwn",
                    "text": `*Approver:* ${approvers[i]}`
                  }
                ]
              },
              {
                  "type": "actions",
                  "elements": [
                      {
                          "type": "button",
                          "text": {
                              "type": "plain_text",
                              "emoji": true,
                              "text": "Approve"
                          },
                          "style": "primary",
                          "value": acceptValue,
                          "action_id": `slack-approval-approve-${i}`
                      },
                      {
                          "type": "button",
                          "text": {
                                  "type": "plain_text",
                                  "emoji": true,
                                  "text": "Reject"
                          },
                          "style": "danger",
                          "value": rejectValue,
                          "action_id": `slack-approval-reject-${i}`
                      }
                  ]
              }
          ]
        });
      }
    })();
    
    for(let i = 0; i < approvers.length; i++) {
      app.action(`slack-approval-approve-${i}`, async ({ack, client, body, logger, payload}) => {
        try {
          if((payload as any).value === acceptValue) {
            await ack();
            const response_blocks = (<BlockAction>body).message?.blocks
            response_blocks.pop()
            response_blocks.push({
              'type': 'section',
              'text': {
                'type': 'mrkdwn',
                'text': `Approved by <@${body.user.id}> `,
              },
            })
    
            await client.chat.update({
              channel: body.channel?.id || "",
              ts: (<BlockAction>body).message?.ts || "",
              blocks: response_blocks
            })

            approvals_received += 1;

            console.log(`Received approval for ${approvers[i]} from ${body.user.id}`);
            console.log(`${approvers.length - approvals_received} approvals still needed.`);

            if(approvals_received == approvers.length) {
              process.exit(0);
            }
          }
        } catch (error) {
          logger.error(error)
          process.exit(1)
        }
      });

      app.action(`slack-approval-reject-${i}`, async ({ack, client, body, logger, payload}) => {
        try {
          if((payload as any).value === rejectValue) {
            await ack();
            const response_blocks = (<BlockAction>body).message?.blocks
            response_blocks.pop()
            response_blocks.push({
              'type': 'section',
              'text': {
                'type': 'mrkdwn',
                'text': `Rejected by <@${body.user.id}>`,
              },
            })
  
            await client.chat.update({
              channel: body.channel?.id || "",
              ts: (<BlockAction>body).message?.ts || "",
              blocks: response_blocks
            });

            console.log(`Rejection received for ${approvers[i]} from ${body.user.id}.`);
  
            process.exit(1);
          }
        } catch (error) {
          logger.error(error)
          process.exit(1)
        }
  
      });
    }

    (async () => {
      const res = await app.start(runport);
      console.log('Waiting Approval reaction.....');
    })();
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()