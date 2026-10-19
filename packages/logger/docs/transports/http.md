# HTTP transport

The HTTP transport sends log entries to a remote collector in batches. It lives at its own import path, `@nextnode-solutions/logger/transports/http`, and the main entry point does not export it.

## Setup

```ts
import {
	createConsoleTransport,
	createLogger,
} from '@nextnode-solutions/logger'
import { createHttpTransport } from '@nextnode-solutions/logger/transports/http'

const http = createHttpTransport({
	endpoint: 'https://logs.example.com/ingest',
	headers: { Authorization: 'Bearer TOKEN' },
	onError: (error, entries) => {
		console.error(`Dropped ${entries.length} log entries: ${error.message}`)
	},
})

const logger = createLogger({
	environment: 'production',
	transports: [createConsoleTransport({ environment: 'production' }), http],
})

logger.info('Shipped to the collector')

// Before the process exits, stop the timer and send what is still buffered.
await logger.dispose()
```

`createHttpTransport` and `new HttpTransport` take an `HttpTransportConfig`. Only `endpoint` is required. The defaults of the other options are documented on `HttpTransportConfig`.

| Option          | Effect                                                                |
| --------------- | --------------------------------------------------------------------- |
| `endpoint`      | The URL every batch is posted to.                                     |
| `headers`       | Extra request headers, such as an authorization token.                |
| `batchSize`     | A full batch of this many entries is sent at once.                    |
| `flushInterval` | The buffer is also sent on a timer with this period.                  |
| `timeout`       | Each request is aborted after this time.                              |
| `maxRetries`    | How many times a failed batch is sent again after its first attempt.  |
| `onError`       | Receives the error and the entries of a batch that could not be sent. |
| `onSuccess`     | Receives the number of entries in a batch that was sent.              |

The constructor checks every numeric option it is given. `batchSize` must be a positive integer and `maxRetries` a non-negative integer. `flushInterval` and `timeout` are milliseconds, so each must be a positive integer no longer than the longest delay a timer accepts. A longer delay would overflow, and the timer would fire almost at once.

## What crosses the boundary

- Each batch is one `POST` to `endpoint`, with a JSON content type and the configured `headers`.
- The body is a JSON object whose `logs` array holds the raw `LogEntry` objects. It is not the flattened JSON line the console prints, but it follows the JSON formatter's rules, so a `bigint` becomes its decimal string and a circular reference becomes a marker.
- Each entry is serialized once per flush, before the first attempt, so every retry sends the same body.
- A response outside the success range counts as a failure, like a network error or a timeout.
- The endpoint must be an `http` or `https` URL. The constructor refuses any other protocol, so a mistyped URL cannot reach a non-HTTP scheme.
- The constructor refuses headers that the HTTP layer manages, such as `Host`, so configuration cannot inject them.

## Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Collecting: constructor validates the config and starts the timer
    Collecting --> Flushing: a full batch or a timer tick
    state Flushing {
        [*] --> Attempt
        Attempt --> Backoff: the request fails and attempts remain
        Backoff --> Attempt: exponential delay
        Attempt --> Sent: the collector accepts the batch
        Attempt --> Lost: the last attempt fails
        state "Lost, handed to onError" as Lost
        Sent --> [*]
        Lost --> [*]
    }
    Flushing --> Collecting: the batch is settled
    Collecting --> Disposed: dispose stops the timer and flushes
    state "Disposed, timer stopped" as Disposed
    note right of Disposed
        Entries logged after dispose are still buffered,
        and only a full batch sends them.
    end note
    Disposed --> [*]
```

`log` only appends to the buffer, so a log call never waits for the network. A flush takes every buffered entry at once. Entries logged during a flush wait for the next one, and a flush requested while another runs is skipped. The buffer has no size limit, so a slow collector makes it grow.

The timer does not keep a Node process alive. A process that exits without `dispose` therefore ends on time, but it loses the entries still in the buffer.

## A flush

```mermaid
sequenceDiagram
    autonumber
    participant Trigger as Full batch, timer or dispose
    participant T as HTTP transport
    participant C as Collector
    participant Hooks as onSuccess and onError
    Trigger->>T: flush
    alt a flush is running or the buffer is empty
        T-->>Trigger: return
    else otherwise
        T->>T: take every buffered entry and serialize each one
        opt an entry cannot be serialized
            T->>Hooks: onError with the error and that entry
        end
        loop until sent or out of attempts
            T->>C: POST the batch within the timeout
            C-->>T: response or error
            opt failure and attempts remain
                T->>T: wait with exponential backoff
            end
        end
        alt sent
            T->>Hooks: onSuccess with the count
        else every attempt failed
            T->>Hooks: onError with the error and the entries
        end
    end
```

## Failures

| Failure                                                               | What is left                                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid endpoint, managed header or numeric option                    | No transport. The constructor throws an `Error` that names the value.                                                                                            |
| A getter or a `toJSON` method in an entry throws during serialization | That entry is left out of the batch. `onError` receives it alone with the error, and the rest of the batch is sent. Without `onError`, nothing reports the loss. |
| Network error, failed status or timeout                               | A retry after an exponential delay, until attempts run out.                                                                                                      |
| Every attempt fails                                                   | The batch is gone from the buffer. `onError` receives it with the last error. Without `onError`, nothing reports the loss.                                       |
| `onSuccess` throws                                                    | The batch still counts as sent, and `onError` is not called. A `console.error` line with the `[logger]` prefix reports the throw.                                |
| `onError` throws                                                      | The loss is still reported once. A `console.error` line with the `[logger]` prefix reports the throw, and the flush and dispose promises still resolve.          |
| The process exits without `dispose`                                   | The entries still in the buffer are lost.                                                                                                                        |
