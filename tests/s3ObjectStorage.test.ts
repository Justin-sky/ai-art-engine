import { describe, expect, it } from 'vitest'
import {
  createEmptyS3CompatibleParams,
  createObjectStorageProvider,
  normalizeObjectStorageSettings,
  pickActiveObjectStorage
} from '../src/shared/objectStorage'
import {
  presignS3GetUrl,
  resolveS3ObjectTarget,
  signS3Authorization
} from '../src/main/services/objectStorage/s3sig'

describe('S3 compatible settings', () => {
  it('keeps the s3 kind and path-style flag', () => {
    const next = normalizeObjectStorageSettings({
      providers: [
        {
          id: 's3-1',
          providerKind: 's3',
          s3: {
            accessKeyId: 'AKIA',
            secretAccessKey: 'secret',
            region: 'auto',
            endpoint: 'account.r2.cloudflarestorage.com',
            bucket: 'media',
            pathStyle: false,
            publicBaseUrl: 'https://cdn.example.com/'
          }
        }
      ]
    })
    expect(next.providers[0]?.providerKind).toBe('s3')
    expect(next.providers[0]?.label).toBe('兼容 Amazon S3')
    expect(next.providers[0]?.s3.endpoint).toBe('https://account.r2.cloudflarestorage.com')
    expect(next.providers[0]?.s3.region).toBe('auto')
    expect(next.providers[0]?.s3.pathStyle).toBe(false)
    expect(next.providers[0]?.s3.publicBaseUrl).toBe('https://cdn.example.com')
  })

  it('picks a complete S3 provider', () => {
    const provider = createObjectStorageProvider('s3', {
      id: 's3ok',
      s3: {
        ...createEmptyS3CompatibleParams(),
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
        bucket: 'media'
      }
    })
    expect(pickActiveObjectStorage({ providers: [provider] })?.id).toBe('s3ok')
  })

  it('rejects an S3 provider with no bucket', () => {
    const provider = createObjectStorageProvider('s3', {
      s3: {
        ...createEmptyS3CompatibleParams(),
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
        bucket: ''
      }
    })
    expect(pickActiveObjectStorage({ providers: [provider] })).toBeNull()
  })
})

describe('S3 SigV4', () => {
  it('builds path-style and virtual-hosted targets', () => {
    const pathStyle = resolveS3ObjectTarget({
      endpoint: 'https://s3.example.com',
      bucket: 'media',
      objectKey: 'a/b.png',
      pathStyle: true
    })
    expect(pathStyle.url).toBe('https://s3.example.com/media/a/b.png')
    expect(pathStyle.host).toBe('s3.example.com')

    const virtual = resolveS3ObjectTarget({
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'examplebucket',
      objectKey: 'test.txt',
      pathStyle: false
    })
    expect(virtual.url).toBe('https://examplebucket.s3.amazonaws.com/test.txt')
    expect(virtual.host).toBe('examplebucket.s3.amazonaws.com')
  })

  /**
   * AWS 文档 GET Object 示例：
   * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
   */
  it('matches the AWS header-auth example', () => {
    const signed = signS3Authorization({
      method: 'GET',
      canonicalUri: '/test.txt',
      host: 'examplebucket.s3.amazonaws.com',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      amzDate: '20130524T000000Z',
      extraHeaders: { range: 'bytes=0-9' }
    })
    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
  })

  it('presigns a GET without requiring the caller to send signed headers', () => {
    const target = resolveS3ObjectTarget({
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'examplebucket',
      objectKey: 'test.txt',
      pathStyle: false
    })
    const url = presignS3GetUrl({
      target,
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      amzDate: '20130524T000000Z',
      expiresSec: 86400
    })
    expect(url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?')).toBe(true)
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
    expect(url).toContain('X-Amz-Expires=86400')
    expect(url).toContain('X-Amz-SignedHeaders=host')
    expect(url).toContain('X-Amz-Signature=')
    expect(url).not.toContain('x-amz-content-sha256')
  })
})
