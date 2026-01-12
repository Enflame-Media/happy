# Certificate Pinning (HAP-624)

This document describes the SSL/TLS certificate pinning implementation for the Happy mobile app.

## Overview

Certificate pinning is a security mechanism that ensures the app only trusts specific certificate public keys when connecting to Happy API servers. This protects against man-in-the-middle (MITM) attacks, even when:

- A device's trusted certificate store is compromised
- A corporate proxy is intercepting traffic
- A rogue WiFi access point is performing SSL interception
- Malware has installed a malicious CA certificate

## How It Works

The app uses `react-native-ssl-public-key-pinning` to pin the SPKI (Subject Public Key Info) hashes of Happy API certificates. This library:

1. Intercepts all network requests made through `fetch()` and `XMLHttpRequest`
2. Validates the server's certificate against the pinned hashes
3. Rejects connections if no pin matches

## Configuration

### Pinned Domains

| Domain | Environment |
|--------|-------------|
| `happy-api.enflamemedia.com` | Production |
| `happy-api-dev.enflamemedia.com` | Development |

### Pin Structure

Each domain has multiple pins for certificate rotation resilience:

1. **Leaf Certificate Pin**: The actual server certificate (primary)
2. **Intermediate CA Pin**: Cloudflare's intermediate CA (backup)
3. **Root CA Pin**: DigiCert root CA (emergency fallback)

## Development Setup

### Bypassed Hosts

Pinning is automatically bypassed for:

- `localhost`
- `127.0.0.1`
- `10.0.2.2` (Android emulator)
- Local network addresses (`192.168.*`)

### Testing with Charles/Proxyman

To test with a MITM proxy during development:

1. Certificate pinning should reject the proxy's certificate
2. Verify by checking for `[CertPinning] Pin validation failed` in logs
3. To temporarily disable pinning, set `EXPO_PUBLIC_DISABLE_CERT_PINNING=1`

### iOS Network Inspector

The Expo network inspector interferes with certificate pinning. The `expo-build-properties` plugin is configured to disable it:

```javascript
// app.config.js
[
    'expo-build-properties',
    {
        ios: {
            networkInspector: false
        }
    }
]
```

## Certificate Rotation

### Before Rotation

1. **Extract new certificate hash** using:
   ```bash
   echo | openssl s_client -servername <hostname> -connect <hostname>:443 | \
     openssl x509 -pubkey -noout | \
     openssl pkey -pubin -outform DER | \
     openssl dgst -sha256 -binary | \
     openssl enc -base64
   ```

2. **Add new hash as backup pin** in `sources/utils/certificatePinning.ts`

3. **Deploy via OTA** (Expo Updates) - no App Store release needed

4. **Wait for user adoption** (~1-2 weeks)

### After Rotation

1. **Remove old certificate hash** from primary position
2. **Move new hash to primary** position
3. **Deploy via OTA**

### Emergency Recovery

If pins become invalid and users are locked out:

1. Pins have an expiration date (graceful degradation)
2. After expiration, all certificates are accepted
3. Push a new OTA update with correct pins ASAP

## Monitoring

### Error Logging

Pin validation failures are logged with `[CertPinning]` prefix:

```
[CertPinning] Pin validation failed for happy-api.enflamemedia.com: Certificate does not match any pinned hashes
```

### Production Monitoring

TODO: Add analytics event for pin failures to detect:
- Attempted MITM attacks
- Certificate rotation issues
- Misconfiguration problems

## Security Considerations

### What Certificate Pinning Protects Against

| Threat | Protection |
|--------|------------|
| Compromised Certificate Authority | Prevents trusting rogue CA-issued certs |
| Corporate MITM Proxy | Blocks SSL inspection |
| Rogue WiFi Access Point | Prevents traffic interception |
| User-installed Certificates | App ignores user trust store |

### What Certificate Pinning Does NOT Protect Against

| Threat | Why Not Protected |
|--------|-------------------|
| Rooted/Jailbroken Device | Can patch SSL validation |
| Memory Tampering | Pins can be modified in memory |
| Reverse Engineering | Pins are extractable from app |
| Server Compromise | Server key can be extracted |

### Additional Recommendations

1. **Token Security**: Tokens are already short-lived with refresh mechanism
2. **E2E Encryption**: User data is end-to-end encrypted (separate from TLS)
3. **RASP**: Consider adding Runtime Application Self-Protection

## Files

| File | Purpose |
|------|---------|
| `sources/utils/certificatePinning.ts` | Main pinning module |
| `sources/utils/certificatePinning.test.ts` | Unit tests |
| `app.config.js` | expo-build-properties config |

## References

- [OWASP Certificate Pinning](https://owasp.org/www-community/controls/Certificate_and_Public_Key_Pinning)
- [react-native-ssl-public-key-pinning](https://github.com/frw/react-native-ssl-public-key-pinning)
- [Android Network Security Config](https://developer.android.com/training/articles/security-config)
- [iOS TrustKit](https://github.com/datatheorem/TrustKit)
