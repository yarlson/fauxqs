import type { SqsStore, SqsQueue } from "../sqs/sqsStore.ts";
import type { SqsMessage } from "../sqs/sqsTypes.ts";
import type { SnsStore } from "../sns/snsStore.ts";
import type { SnsTopic, SnsSubscription } from "../sns/snsTypes.ts";
import type { S3PersistenceProvider } from "../s3/s3Persistence.ts";

/**
 * Full persistence provider interface covering SQS, SNS, and S3.
 * Implemented by SqlitePersistence and (future) alternative backends.
 */
export interface PersistenceProvider extends S3PersistenceProvider {
  // ── SQS Queue write-through ──
  insertQueue(queue: SqsQueue): void;
  deleteQueue(name: string): void;
  updateQueueAttributes(
    name: string,
    attributes: Record<string, string>,
    lastModified: number,
  ): void;
  updateQueueSequenceCounter(name: string, counter: number): void;

  // ── SQS Message write-through ──
  insertMessage(queueName: string, msg: SqsMessage): void;
  deleteMessage(messageId: string): void;
  updateMessageInflight(
    messageId: string,
    receiptHandle: string,
    visibilityDeadline: number,
    receiveCount: number,
    firstReceiveTimestamp: number | undefined,
  ): void;
  updateMessageReady(messageId: string): void;
  deleteQueueMessages(queueName: string): void;
  deleteAllMessages(): void;

  // ── SNS Topic write-through ──
  insertTopic(topic: SnsTopic): void;
  deleteTopic(arn: string): void;
  updateTopicAttributes(arn: string, attributes: Record<string, string>): void;
  updateTopicSubscriptionArns(arn: string, arns: string[]): void;

  // ── SNS Subscription write-through ──
  insertSubscription(sub: SnsSubscription): void;
  deleteSubscription(arn: string): void;
  updateSubscriptionAttributes(arn: string, attributes: Record<string, string>): void;

  // ── Bulk operations ──
  clearMessagesAndObjects(): void;
  purgeAll(): void;

  // ── Load on startup ──
  load(sqsStore: SqsStore, snsStore: SnsStore, s3Store: S3Store): void;
  loadSqsAndSns(sqsStore: SqsStore, snsStore: SnsStore): void;

  // ── Lifecycle ──
  close(): void;
}

// Re-import S3Store type for the load signature
import type { S3Store } from "../s3/s3Store.ts";
