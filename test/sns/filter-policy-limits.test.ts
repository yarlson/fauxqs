import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  CreateTopicCommand,
  SubscribeCommand,
  SetSubscriptionAttributesCommand,
} from "@aws-sdk/client-sns";
import { createSnsClient } from "../helpers/clients.js";
import { startFauxqsTestServer, type FauxqsServer } from "../helpers/setup.js";

describe("SNS Filter Policy Limits", () => {
  let server: FauxqsServer;
  let sns: ReturnType<typeof createSnsClient>;
  let subscriptionArn: string;

  beforeAll(async () => {
    server = await startFauxqsTestServer();
    sns = createSnsClient(server.port);
    const topic = await sns.send(
      new CreateTopicCommand({ Name: "filter-limits-topic" }),
    );
    const sub = await sns.send(
      new SubscribeCommand({
        TopicArn: topic.TopicArn!,
        Protocol: "sqs",
        Endpoint: "arn:aws:sqs:us-east-1:000000000000:filter-limits-queue",
      }),
    );
    subscriptionArn = sub.SubscriptionArn!;
  });

  afterAll(async () => {
    sns.destroy();
    await server.stop();
  });

  it("rejects filter policy with more than 5 attribute keys", async () => {
    const policy: Record<string, string[]> = {};
    for (let i = 0; i < 6; i++) {
      policy[`key${i}`] = ["value"];
    }
    await expect(
      sns.send(
        new SetSubscriptionAttributesCommand({
          SubscriptionArn: subscriptionArn,
          AttributeName: "FilterPolicy",
          AttributeValue: JSON.stringify(policy),
        }),
      ),
    ).rejects.toThrow(/too complex|InvalidParameter/i);
  });

  it("rejects filter policy with more than 150 value combinations", async () => {
    // 5 keys x 31 values each = 155 combinations > 150
    const policy: Record<string, string[]> = {};
    for (let i = 0; i < 5; i++) {
      policy[`key${i}`] = Array.from({ length: 31 }, (_, j) => `val${j}`);
    }
    await expect(
      sns.send(
        new SetSubscriptionAttributesCommand({
          SubscriptionArn: subscriptionArn,
          AttributeName: "FilterPolicy",
          AttributeValue: JSON.stringify(policy),
        }),
      ),
    ).rejects.toThrow(/too complex|InvalidParameter/i);
  });

  it("rejects filter policy with more than 3 wildcards in a single pattern", async () => {
    const policy = {
      key1: [{ wildcard: "a*b*c*d*" }],
    };
    await expect(
      sns.send(
        new SetSubscriptionAttributesCommand({
          SubscriptionArn: subscriptionArn,
          AttributeName: "FilterPolicy",
          AttributeValue: JSON.stringify(policy),
        }),
      ),
    ).rejects.toThrow(/wildcard|InvalidParameter/i);
  });

  it("rejects filter policy exceeding 100 total wildcard complexity points", async () => {
    // 1 key with 34 wildcard patterns, each with 3 wildcards = 34*3 = 102 > 100
    // Combinations = 34 (under 150), keys = 1 (under 5)
    const policy = {
      key1: Array.from({ length: 34 }, (_, j) => ({ wildcard: `a*b*c*${j}` })),
    };
    await expect(
      sns.send(
        new SetSubscriptionAttributesCommand({
          SubscriptionArn: subscriptionArn,
          AttributeName: "FilterPolicy",
          AttributeValue: JSON.stringify(policy),
        }),
      ),
    ).rejects.toThrow(/wildcard|complexity|InvalidParameter/i);
  });

  it("rejects filter policy with more than 3 wildcards in anything-but wildcard pattern", async () => {
    const policy = {
      key1: [{ "anything-but": { wildcard: "a*b*c*d*" } }],
    };
    await expect(
      sns.send(
        new SetSubscriptionAttributesCommand({
          SubscriptionArn: subscriptionArn,
          AttributeName: "FilterPolicy",
          AttributeValue: JSON.stringify(policy),
        }),
      ),
    ).rejects.toThrow(/wildcard|InvalidParameter/i);
  });

  it("accepts filter policy with wildcards within limits", async () => {
    const policy = {
      key1: [{ wildcard: "a*b*c*" }],
      key2: [{ wildcard: "x*" }],
    };
    await sns.send(
      new SetSubscriptionAttributesCommand({
        SubscriptionArn: subscriptionArn,
        AttributeName: "FilterPolicy",
        AttributeValue: JSON.stringify(policy),
      }),
    );
  });

  it("accepts filter policy within limits", async () => {
    const policy = {
      key1: ["a", "b"],
      key2: ["c"],
      key3: ["d", "e", "f"],
    };
    await sns.send(
      new SetSubscriptionAttributesCommand({
        SubscriptionArn: subscriptionArn,
        AttributeName: "FilterPolicy",
        AttributeValue: JSON.stringify(policy),
      }),
    );
  });
});
