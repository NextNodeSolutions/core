# Resend provider

This page explains how the Resend adapter turns an `EmailMessage` into a Resend request, and how Resend's answer becomes a `SendResult`.

## Setup

Install the optional peer `resend`, then select the provider by name and pass the API key.

```ts
const emails = await createEmailManager({
	provider: 'resend',
	providerConfig: { apiKey },
})
```

`providerConfig` takes the fields of `ResendProviderConfig`, of which `apiKey` is required. The provider registry rejects an empty or blank key before it loads the SDK. The Resend SDK reads the `RESEND_API_KEY` environment variable when it gets no key, and this check means that fallback never runs. When `resend` is not installed, setup throws an error that names the install command.

## What crosses the boundary

| Message field                        | What Resend receives                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `from`, `to`, `cc`, `bcc`, `replyTo` | Each recipient as a string. An `{ email, name }` recipient becomes `Name <email>`. Every field except `from` goes out as an array. |
| `subject`, `html`                    | Unchanged.                                                                                                                         |
| `text`, `attachments`, `tags`        | Forwarded when present and left out otherwise. Attachment content and content type pass through unchanged.                         |
| `headers`                            | The list of name and value pairs becomes a single header object.                                                                   |
| `scheduledAt`                        | A `Date` becomes an ISO 8601 string. A string passes through unchanged.                                                            |

The adapter sends no idempotency key. A caller that retries after a network error can therefore deliver the same email twice.

## Send

```mermaid
sequenceDiagram
    autonumber
    participant M as Email manager
    participant A as Resend adapter
    participant SDK as Resend SDK
    M->>A: send EmailMessage
    A->>A: shared validation
    alt message invalid
        A-->>M: VALIDATION_ERROR result
    else message valid
        A->>SDK: emails.send with the mapped payload
        alt SDK returns an error object
            A-->>M: failure, code classified from the error name, status and message
        else SDK throws
            A-->>M: failure, code classified from the thrown error
        else SDK returns data
            A-->>M: success with the Resend message ID
        end
    end
```

The Resend SDK reports API errors and network failures in its return value. It throws only on unexpected errors. Both paths go through one ordered set of rules, one rule per error code.

A returned error carries Resend's error name, its HTTP status code and a message. Classification matches the name first, then the status code, then keywords in the lowercased message. Within each step the first matching rule wins. The name decides before the status because a status can mislead: Resend reports some validation errors with a forbidden status, and they stay `VALIDATION_ERROR`. A sending quota counts as a rate limit. A failure to reach Resend comes back with no status code, so its message decides. The returned error object becomes `originalError` unchanged, so a caller can read Resend's name and status code from it. When that object has no message, the failure gets a generic one.

A thrown error has no name or status from Resend, so only the message keywords classify it, and the thrown value becomes `originalError`. A thrown value that is not an `Error` becomes `UNKNOWN_ERROR`.

An error that no rule matches becomes `PROVIDER_ERROR`. Some codes replace Resend's message with a generic one. Every failure except one from the shared validation carries `resend` as its `provider`.

## Check credentials

```mermaid
sequenceDiagram
    autonumber
    participant App as Application
    participant A as Resend adapter
    participant SDK as Resend SDK
    App->>A: validateConfig
    A->>SDK: list the account domains
    alt SDK returns an error object or throws
        A->>A: log the error message
        A-->>App: false
    else SDK returns data
        A-->>App: true
    end
```

The check resolves `false` when Resend rejects the key, when Resend cannot be reached and when the SDK throws. A key restricted to sending also fails it, because Resend refuses such a key the domain list.
