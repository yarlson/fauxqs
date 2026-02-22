import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  CreateBucketCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCopyCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createS3Client } from "../helpers/clients.js";
import { startFauxqsTestServer, type FauxqsServer } from "../helpers/setup.js";

describe("S3 UploadPartCopy", () => {
  let server: FauxqsServer;
  let s3: ReturnType<typeof createS3Client>;
  const srcBucket = "copy-part-src";
  const dstBucket = "copy-part-dst";

  beforeAll(async () => {
    server = await startFauxqsTestServer();
    s3 = createS3Client(server.port);
    await s3.send(new CreateBucketCommand({ Bucket: srcBucket }));
    await s3.send(new CreateBucketCommand({ Bucket: dstBucket }));
  });

  afterAll(async () => {
    s3.destroy();
    await server.stop();
  });

  it("copies an existing object as a multipart part", async () => {
    const sourceData = Buffer.alloc(5 * 1024 * 1024, "x");
    await s3.send(new PutObjectCommand({ Bucket: srcBucket, Key: "source-obj", Body: sourceData }));

    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
      Bucket: dstBucket, Key: "dest-obj",
    }));

    const copyResult = await s3.send(new UploadPartCopyCommand({
      Bucket: dstBucket, Key: "dest-obj", UploadId, PartNumber: 1,
      CopySource: `${srcBucket}/source-obj`,
    }));
    expect(copyResult.CopyPartResult?.ETag).toBeDefined();

    await s3.send(new CompleteMultipartUploadCommand({
      Bucket: dstBucket, Key: "dest-obj", UploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: copyResult.CopyPartResult!.ETag }] },
    }));

    const obj = await s3.send(new GetObjectCommand({ Bucket: dstBucket, Key: "dest-obj" }));
    const body = await obj.Body!.transformToByteArray();
    expect(body.length).toBe(5 * 1024 * 1024);
  });

  it("copies a byte range from source object larger than 5 MiB", async () => {
    // Source must be >5 MiB for byte-range copy
    const sourceData = Buffer.alloc(6 * 1024 * 1024, 0);
    // Write a known pattern at bytes 100-104
    sourceData.write("HELLO", 100);
    await s3.send(new PutObjectCommand({ Bucket: srcBucket, Key: "range-source", Body: sourceData }));

    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
      Bucket: dstBucket, Key: "range-dest",
    }));

    const copyResult = await s3.send(new UploadPartCopyCommand({
      Bucket: dstBucket, Key: "range-dest", UploadId, PartNumber: 1,
      CopySource: `${srcBucket}/range-source`,
      CopySourceRange: "bytes=100-104",
    }));
    expect(copyResult.CopyPartResult?.ETag).toBeDefined();

    await s3.send(new CompleteMultipartUploadCommand({
      Bucket: dstBucket, Key: "range-dest", UploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: copyResult.CopyPartResult!.ETag }] },
    }));

    const obj = await s3.send(new GetObjectCommand({ Bucket: dstBucket, Key: "range-dest" }));
    const body = await obj.Body!.transformToString();
    expect(body).toBe("HELLO");
  });

  it("copies across buckets", async () => {
    await s3.send(new PutObjectCommand({
      Bucket: srcBucket, Key: "cross-bucket-src",
      Body: Buffer.alloc(5 * 1024 * 1024, "z"),
    }));

    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
      Bucket: dstBucket, Key: "cross-bucket-dest",
    }));

    const copyResult = await s3.send(new UploadPartCopyCommand({
      Bucket: dstBucket, Key: "cross-bucket-dest", UploadId, PartNumber: 1,
      CopySource: `${srcBucket}/cross-bucket-src`,
    }));

    await s3.send(new CompleteMultipartUploadCommand({
      Bucket: dstBucket, Key: "cross-bucket-dest", UploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: copyResult.CopyPartResult!.ETag }] },
    }));

    const obj = await s3.send(new GetObjectCommand({ Bucket: dstBucket, Key: "cross-bucket-dest" }));
    const body = await obj.Body!.transformToByteArray();
    expect(body.length).toBe(5 * 1024 * 1024);
  });

  it("rejects byte-range copy when source is 5 MiB or smaller", async () => {
    await s3.send(new PutObjectCommand({ Bucket: srcBucket, Key: "small-range-src", Body: Buffer.from("small") }));

    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
      Bucket: dstBucket, Key: "small-range-dest",
    }));

    await expect(
      s3.send(new UploadPartCopyCommand({
        Bucket: dstBucket, Key: "small-range-dest", UploadId, PartNumber: 1,
        CopySource: `${srcBucket}/small-range-src`,
        CopySourceRange: "bytes=0-2",
      }))
    ).rejects.toThrow(/not supported as a byte-range copy source/i);
  });

  it("rejects copy source range where start exceeds source length", async () => {
    const sourceData = Buffer.alloc(6 * 1024 * 1024, 0);
    await s3.send(new PutObjectCommand({ Bucket: srcBucket, Key: "range-bounds-src", Body: sourceData }));

    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
      Bucket: dstBucket, Key: "range-bounds-dest",
    }));

    await expect(
      s3.send(new UploadPartCopyCommand({
        Bucket: dstBucket, Key: "range-bounds-dest", UploadId, PartNumber: 1,
        CopySource: `${srcBucket}/range-bounds-src`,
        CopySourceRange: `bytes=${6 * 1024 * 1024 + 100}-${6 * 1024 * 1024 + 200}`,
      }))
    ).rejects.toThrow(/range.*not valid|invalid/i);
  });

  it("clamps copy source range end to source object length", async () => {
    const sourceData = Buffer.alloc(6 * 1024 * 1024, 0);
    sourceData.write("TAIL", 6 * 1024 * 1024 - 4);
    await s3.send(new PutObjectCommand({ Bucket: srcBucket, Key: "range-clamp-src", Body: sourceData }));

    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
      Bucket: dstBucket, Key: "range-clamp-dest",
    }));

    // End extends past source length — should clamp
    const copyResult = await s3.send(new UploadPartCopyCommand({
      Bucket: dstBucket, Key: "range-clamp-dest", UploadId, PartNumber: 1,
      CopySource: `${srcBucket}/range-clamp-src`,
      CopySourceRange: `bytes=${6 * 1024 * 1024 - 4}-${6 * 1024 * 1024 + 999}`,
    }));
    expect(copyResult.CopyPartResult?.ETag).toBeDefined();

    await s3.send(new CompleteMultipartUploadCommand({
      Bucket: dstBucket, Key: "range-clamp-dest", UploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: copyResult.CopyPartResult!.ETag }] },
    }));

    const obj = await s3.send(new GetObjectCommand({ Bucket: dstBucket, Key: "range-clamp-dest" }));
    const body = await obj.Body!.transformToString();
    expect(body).toBe("TAIL");
  });

  it("returns NoSuchKey when copy source does not exist", async () => {
    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
      Bucket: dstBucket, Key: "fail-dest",
    }));
    await expect(
      s3.send(new UploadPartCopyCommand({
        Bucket: dstBucket, Key: "fail-dest", UploadId, PartNumber: 1,
        CopySource: `${srcBucket}/nonexistent-key`,
      }))
    ).rejects.toThrow(/specified key does not exist/);
  });
});

describe("S3 UploadPartCopy with relaxedRules", () => {
  let server: FauxqsServer;
  let s3: ReturnType<typeof createS3Client>;
  const bucket = "relaxed-copy-bucket";

  beforeAll(async () => {
    server = await startFauxqsTestServer({ relaxedRules: { disableMinCopySourceSize: true } });
    s3 = createS3Client(server.port);
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    s3.destroy();
    await server.stop();
  });

  it("allows byte-range copy from source smaller than 5 MiB when disableMinCopySourceSize is true", async () => {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: "small-src", Body: Buffer.from("0123456789") }));

    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
      Bucket: bucket, Key: "small-dest",
    }));

    const copyResult = await s3.send(new UploadPartCopyCommand({
      Bucket: bucket, Key: "small-dest", UploadId, PartNumber: 1,
      CopySource: `${bucket}/small-src`,
      CopySourceRange: "bytes=3-7",
    }));
    expect(copyResult.CopyPartResult?.ETag).toBeDefined();

    await s3.send(new CompleteMultipartUploadCommand({
      Bucket: bucket, Key: "small-dest", UploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: copyResult.CopyPartResult!.ETag }] },
    }));

    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "small-dest" }));
    const body = await obj.Body!.transformToString();
    expect(body).toBe("34567");
  });
});
