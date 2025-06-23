# RxPaired-server

## Note about the default server behavior

This server was initially written mostly for short-scale usage, to be exposed to
the internet on a relatively small server and to require as few maintenance as
possible.

As such, it will by default generate a password and will shutdown automatically
when any "abnormal" but impactful behavior is detected (all of this is
configurable):

1. when more than 50 passwords have been received the last 24h
2. when more than 500 client connections happen in the last 24h
3. when more than 500 device connections happen in the last 24h
4. When more than a million WebSocket messages coming from all devices is
   received in a group of 24h (also, client messages that are too long are
   ignored)
5. When more than 1000 message coming from all inspectors is received in a
   group of 24h.

The server can in any case be restarted and those limitations be disabled at any
time.

This was mostly done as a prevention measure from our own mistakes (we could for
example have accidently written an infinite loop blasting logs!) but also as a
signal for when curious traffic is coming from elsewhere.

## How to run it

Before being able to start this server, you first need to install the few node
dependencies it needs and build it:

```sh
npm install
npm run build --workspace="server"
```

This server can then be run simply by calling the `./server/RxPaired-server` executable:

```sh
node ./server/RxPaired-server
```

It is recommended that you look at this server options first to see if there's
things you want to tweak. You can look at all available options by calling:

```sh
node ./server/RxPaired-server --help
```

## About HTTPS/WSS

The RxPaired-server uses WebSocket connections relying on HTTP, and not HTTPS.

This may be problematic when testing applications on devices running as an HTTPS
page, as browsers will generally block such "unsecure" requests when coming from
a "secure" web page.

To work-around this issue, it is for now recommended to set up an HTTPS proxy,
which will redirect to the right RxPaired port.
This can be done by using server softwares like [Apache](https://httpd.apache.org/)
or [Nginx](https://www.nginx.com/) on servers with a valid certificate, **OR**,
if you don't have such server at hand, solutions like [ngrok](https://ngrok.com/).

Note that technically, if you prefer to only proxify one WebSocket connection
between the two listened to, the one listening for devices is usually the most
important one.
This is because the other one will be linked to the `RxPaired-inspector`, which
you're hosting yourself. As such, you may just decide to run it from an HTTP URL
which itself has no issue relyng on another HTTP server.
And even when launching the RxPaired-inspector through HTTPS, it should
generally be easy enough to disable the corresponding "mixed contents" security
checks on your personal browsers.

## How to update it and build it

The RxPaired-server code is written in TypeScript and can be found in the `server/src`
directory, the main file (the first file being called) being `server/src/main.ts`.

Before building it, you should install all dependencies:

```sh
npm install
```

And you can then call the `build` script to update the code in `./server/build` (on
which `./server/RxPaired-server` points to):

```sh
npm run build --workspace="server"
```

You can look at the other available npm scripts by peeking inside
`server/package.json`.

## Server API

This server exposes multiple routes by WebSocket to perform various actions.

Note that calling the following routes should already be implemented by the
RxPaired-Inspector and RxPaired-Client implementations. As such you don't need
to read this chapter unless either:

- You want to update either the RxPaired-Inspector or RxPaired-Client and that
  implies understanding the current API.

- You want to update the RxPaired-server's code.

- You want to re-implement any of the bricks of RxPaired, yet not all as them,
  and as such you want to understand its API.

- You're curious about how it works.

### To/From the Inspector

This chapter specifies the possible exchanges between inspectors (the web page
used for inspection) and the RxPaired's server.

If the server is configured with a password, like it is by default, **all** the
following URLs in this chapter MUST first begin by the `/!inspector/<SERVER_PASSWORD>`
path, where `<SERVER_PASSWORD>` is the server's password, then concatenating on top
of it the following paths.

If the server is configured with no password, **all** following URLs MUST just be
prefixed by an `/!inspector` path.

#### `/!list`

List the active tokens and gives some information about the RxPaired-server.

"Active tokens" are tokens that can currently be used by a device (running
RxPaired-client) and that can be inspected through an RxPaired-inspector (see
corresponding routes).

The server will regularly send (every ~3 seconds) that data back to the
inspector through that WebSocket connection starting immediately when the
request has been performed.

The data sent is an UTF-8-encoded JSON with the following keys:

- `isNoTokenEnabled` (boolean): If `true`, the `/!notoken` route can be used
  by devices (see devices API) as this feature has been enabled on the server.

- `tokenList` (Array.Object): Array of objects each having the following
  properties:

  - `tokenId` (string): The token identifier itself, which can be used on
    the inspector (and which can be used in stored logs) to inspect the
    corresponding logs.

  - `date` (number): Unix timestamp on the server at the time the token has
    been created.

  - `isPersistent` (boolean): If `true` this token will only expire once
    its expiration date (see `msUntilExpiration` property) has been
    reached.

    If `false`, the token will expire either when its expiration date has
    been reached **OR** when both no inspector and no device are connected,
    through this RxPaired-server, to that token anymore.

  - `msUntilExpiration` (number): amount of milliseconds until the token
    expires and becomes thus invalid.
    After that delay, the token has to be either re-created, or a new manual
    expiration has to be set on it through the right API.

#### `/<TOKEN_ID>/<EXPIRATION_TIME_MS>`

Where:

- `<TOKEN_ID>` is a string composed only of alphanumeric characters.

- `<EXPIRATION_TIME_MS>` is a time in milliseconds.

  Note that that part is completely optional (description of the semantics
  and syntax of not setting it in the next route's description).
  **Not setting an expiration time is probably what you want to do in most
  cases**. This API is only listed first as it is a more general case.

##### Behavior

If no token currently exists with that `<TOKEN_ID>`, creates a regular
(non-persistent) token which will allow a unique device to send logs to
the server.

Non-persistent tokens will remain available until either (whichever comes first):

- its expiration time is reached, which is provided by `<EXPIRATION_TIME_MS>`
  (which is the remaining availability time of that token from the point this
  request is received, in milliseconds).

- all WebSocket connections linked to that token (including this one, the
  device's and maybe other RxPaired-inspectors listening to it) are all
  disconnected from the server.

If you want a token to stay alive until its expiration date, even when no
WebSocket connection linked to it are alive, you may want to create a
"persistent" token instead (see corresponding route).

If a new request is done through that route while a token with that
`<TOKEN_ID>` was already created, the already-created token will keep its
original persistence status but the expiration date will be updated with
the new set `<EXPIRATION_TIME_MS>`.

This WebSocket connection is then kept alive and different kind of messages
(device logs, instruction results etc. see below) will be sent through it.
The inspector may also send information through this WebSocket (see below).

##### Messages sent by the server

Various messages may be sent by the server through that WebSocket connection:

- **ack**: ack messages are just an UTF-8-encoded `ack` string sent by the
  server as soon as it receives the connection and considers it valid (for
  example: the right password has been set). In cases where the request is
  invalid, the server will close the WebSocket instead.

  It is always the first message sent, and is sent only once.

  There is no response to this message, it is just here to indicate that
  the connection has been well received.

- **Initial Device Message**: Message sent by the server which describes the
  first log(s) sent by the device. It should be sent before any logs messages
  originating from the device.

  All logs and player information from a previous debugging session should
  be cleared by the inspector when receiving this message.

  The content of this message is an UTF-8 encoded JSON, with the following
  keys:

  - `type` (string): Always set to `"Init"`. This allows you to identify
    that this is an `Init` message.

  - `value` (object): Object with the following keys:

    - `timestamp` (number): The monotically-increasing timestamp in
      milliseconds choosen by the device when its first message was sent.

      It is intended to be compared with `dateMs` so other messages
      originating from the device may be easily dated.

    - `dateMs` (number): Unix timestamp in milliseconds generated by the
      device at the same moment that the `timestamp` property was produced.

    - `history` (Array.string): The last `N` "logs" sent by the device in
      chronological order, with `N` ranging from `0` to the `maxHistorySize`
      value communicated in this same object.

      History is only enabled if you explicitely enabled it through the
      right server flag. In other cases, this array is empty.

      Note that only device messages that are actually passed through to
      inspectors (as opposed to messages only meant for the server) are
      stored in this history (more details below).

    - `maxHistorySize` (number): The maximum number of elements the
      `history` array (communicated through this same object) can contain.

      If `history` has the same length, then it may be that older logs
      have been removed from it to respect that limit.

- **Evaluation results**: An inspector can send JavaScript code to be executed
  on the device, those are called "evaluations" by the RxPaired-server.

  When and if a device executes such instructions and if it executes with
  success, it will return the result of executing it in an "Evaluation result"
  message which is described here.

  Note that ALL inspector listening to a given device (through its token),
  even those that did not send the original JavaScript code, will receive the
  corresponding evaluation result if sent by the device.

  Evaluation results messages are UTF-8 encoded JSON with the following
  keys:

  - `type` (string): Always set to `"eval-result"`. This allows you to
    identify that this is an Evaluation result message.

  - `value` (object): Object with the following keys:

    - `id` (string): The same identifier that was sent alongside the
      corresponding original evaluation message sent by the inspector.

      Can be used if multiple evaluation messages were sent to know
      which result is about which evaluation.

    - `data` (string|undefined): The optional result itself, transformed
      to a string format by the RxPaired-client.

- **Evaluation errors**: An inspector can send JavaScript code to be executed
  on the device, those are called "evaluations" by the RxPaired-server.

  When and if a device executes such instructions and if the corresponding
  code throws on the device, the RxPaired-client will return the error
  obtained when executing it in an "Evaluation error" message which is
  described here.

  Note that ALL inspector listening to a given device (through its token),
  even those that did not send the original JavaScript code, will receive the
  corresponding evaluation error if sent by the device.

  Evaluation errors messages are UTF-8 encoded JSON with the following
  keys:

  - `type` (string): Always set to `"eval-error"`. This allows you to
    identify that this is an Evaluation error message.

  - `value` (object): Object with the following keys:

    - `id` (string): The same identifier that was sent alongside the
      corresponding original evaluation message sent by the inspector.

      Can be used if multiple evaluation messages were sent to know
      which error is about which evaluation message.

    - `error` (object): Object with the following keys:

      - `name` (string | undefined): Optional `name` property on the
        corresponding error JavaScript object thrown.

      - `message` (string | undefined): Optional `message` property on
        the corresponding error JavaScript object thrown.

- **ping**: Ping messages are just an UTF-8-encoded `ping` string, which the
  other side of the connection (the inspector) is supposed to respond
  by `pong`.

  The idea behind this message is to ensure that the connection stays open
  even when no message has been received in a long time, as some applications
  (such as servers) might automatically decide to close the connection
  otherwise.

- **logs**: Other messages that do not correspond to either of the preceding
  conditions are "logs" directly originating from the device, the server just
  passing them through through the inspector(s)'s WebSocket directly as they
  are received.

  They should be encoded as an UTF-8 string with the following format:
  `<TIMESTAMP> [<LOG_NAMESPACE>] <LOG_MESSAGE>`

  Where:

  - `<TIMESTAMP>` is the monotically-increasing timestamp in milliseconds
    produced by the same method than the "Initial Device Message" sent by
    the device.

  - `<LOG_NAMESPACE>` is an identifier for the type of log. It is generally
    correlated to the level of the logs (e.g. `error`, `debug` etc.)
    but may also be used to identify another category of log (e.g. `Network`
    for Network-related log).

  - `<LOG_MESSAGE>` is the logged message itself.

    The message may be truncated (compared to what has been sent by the
    device) if it was originally longer than the maximum length configured
    by the RxPaired-server (see server flags), which is expressed in UTF-16
    code units (JavaScript!).

##### Messages sent TO the server

As a websocket connection, exchanges are bi-directional. An inspector can send
through that route the following types of messages:

- **pong**: Pong messages are just an UTF-8-encoded `pong` string, which is
  the message an inspector should send after receiving a `ping` message
  through that same connection.

- **Evaluation**: Those messages allow an inspector to ask the device to
  execute some JavaScript code present in this message.

  After executing the corresponding code, the device will either send an
  "Evaluation result" message if it executed with success or an
  "Evaluation error" message if it threw. Both of those messages are
  communicated by the server and are documented in this API documentation.

  Evaluation messages are UTF-8 encoded JSON with the following keys:

  - `type` (string): Always set to `"eval"`. This allows the server and
    device to identify that this is an Evaluation message.

  - `value` (object): Object with the following keys:

    - `id` (string): Identifier that will be repeated by the device on
      the corresponding result (either an "Evaluation result" if it
      executed with success or an "Evaluation error" if it threw).

    - `instruction` (string): The JavaScript code to execute on the
      device. Note that the `return` JS keywork can be used to return
      data alongside the corresponding "Evaluation result" message, just
      as if returning that data as the last instruction of a JS function.

#### `/<TOKEN_ID>`

Like for `/<TOKEN_ID>/<EXPIRATION_TIME_MS>`, but:

- if no token with that name was created, we will rely on the default
  expiration time configured on the server instead (see `-h` server flag).

- if a token with that name was already created, its original expiration date
  will remain unchanged.

#### `/!persist/<TOKEN_ID>/<EXPIRATION_TIME_MS>`

Where:

- `<TOKEN_ID>` is a string composed only of alphanumeric characters.

- `<EXPIRATION_TIME_MS>` is a time in milliseconds.

  Note that that part is completely optional (description of the semantics
  and syntax of not setting it in the next route's description).

##### Behavior

Creates a new "persistent" token - which allows device to send logs to the
server - with the identifier indicated by `<TOKEN_ID>`.

The WebSocket connection will then remain open, and communicate the same
messages than the equivalent `/<TOKEN_ID>/<EXPIRATION_TIME_MS>` route (see its
documentation).

**Non**-persistent tokens are removed as soon as its linked device and all
inspector pages stopped listening to it.
Persistent tokens however are kept alive by the server until their expiration
date is reached, which is provided by `<EXPIRATION_TIME_MS>` (which is the
remaining availability time of that token from the point that request is
received, in milliseconds).

Unlike regular tokens, persistent tokens thus allows the device to send logs to
the server whenever it wants, even when no inspector is listening to that token,
as long as the expiration date is not reached.

This is useful either when needing to debug on another person's device without
needing to synchronize the setup of an RxPaired-inspector page or just to speed
up some quick tests when you don't want to open an RxPaired-inspector.
The flip side however is that any device knowing that token's value may be able
to send logs to the server during the lifetime of this token, whereas
non-persistent tokens offer more security by generally being very ephemeral.

Note that you can update a persistent token's expiration, by re-calling the same
API for the same `<TOKEN_ID>` but with a different `<EXPIRATION_TIME_MS>`, which
will be the new one considered.

To remove a persisted token, you can set its `<EXPIRATION_TIME_MS>` to either
`0` or to a negative value.

If a new request is done through that route while a token with that
`<TOKEN_ID>` was already created, the already-created token will become
persistent if it's wasn't already and the expiration date will be updated with
the new set `<EXPIRATION_TIME_MS>`.

#### `/!persist/<TOKEN_ID>`

Like for `/!persist/<TOKEN_ID>/<EXPIRATION_TIME_MS>`, but:

- if no token with that name was created, we will rely on the default
  expiration time configured on the server instead (see `-h`server flag).

- if a token with that name was already created, it will be made persistent if
  it wasn't already but its original expiration date will remain unchanged.

### To/From the Device

This chapter specifies the possible exchanges between devices (thanks to the
script running on the inspected device) and the RxPaired's server.

The following subchapters will list the various routes exposed by the
RxPaired-server for the device. Unlike URLs intended for the inspector, no prefix
should be added unless explicitly specified.

#### `/<TOKEN_ID>`

Where:

- `<TOKEN_ID>` is a string composed only of alphanumeric characters.

  That has been previously explicitely created by an RxPaired-inspector
  **AND** that is still considered "active" (see routes exposed for the
  inspector for more information on what this implies).

##### Behavior

Allow the device to begin sending logs linked to that token, so the server
may store them (if the right server flag is set) and communicate it to the
RxPaired-inspectors currently listening to that token.

Note that **only one device at a time** can maintain a connection on that
specific token. If multiple WebSocket connections for the same token are done
at the same time on the RxPaired-server, all but the last devices linked to
that token will be disconnected.

##### Messages sent by the server

Messages may be sent by the server through that WebSocket connection:

- **ack**: ack messages are just an UTF-8-encoded `ack` string sent by the
  server as soon as it receives the connection and considers it valid (for
  example: the wanted token exists). In cases where the request is invalid,
  the server will close the WebSocket instead.

  It is always the first message sent, and is sent only once.

  There is no response to this message, it is just here to indicate that
  the connection has been well received.

- **ping**: Ping messages are just an UTF-8-encoded `ping` string, which the
  other side of the connection (the RxPaired-client) is supposed to respond
  by `pong`.

  The idea behind this message is to ensure that the connection stays open
  even when no message has been received in a long time, as some applications
  (such as servers) might automatically decide to close the connection
  otherwise.

- **Evaluation**: Those messages originates from an RxPaired-inspector and
  allows it to execute some JavaScript code present in this message.

  After executing the corresponding code, the device should either send an
  "Evaluation result" message if it executed with success or an
  "Evaluation error" message if the execution threw. Both of those messages are
  at destinations of RxPaired-inspectors.

  Evaluation messages are UTF-8 encoded JSON with the following keys:

  - `type` (string): Always set to `"eval"`. This allows you to identify
    that this is an Evaluation message.

  - `value` (object): Object with the following keys:

    - `id` (string): Identifier that should be repeated by on the
      corresponding result (either an "Evaluation result" if it
      executed with success or an "Evaluation error" if it threw).

    - `instruction` (string): The JavaScript code to execute.
      Note that the `return` JS keywork indicates that the returned
      data should be sent alongside the corresponding "Evaluation result"
      message, just as if returning that data as the last instruction of a
      JS function.

##### Messages sent TO the server

- **Initial Message**: This should be the initial message sent by the
  device.

  The content of this message is an UTF-8 encoded string, with the following
  format:
  `Init v1 <TIMESTAMP> <CURRENT_DATE>`

  Where:

  - `<TIMESTAMP>` is a monotically-increasing timestamp in milliseconds
    choosen by the device when its first message was sent.

    It is intended to be compared with `<CURRENT_DATE>` so other messages
    originating from the device may be easily dated.

  - `<CURRENT_DATE>` is a unix timestamp in milliseconds generated by the
    device at the same moment that the `<TIMESTAMP>` property was produced.

- **pong**: Pong messages are just an UTF-8-encoded `pong` string, which is
  the message an inspector should send after receiving a `ping` message
  through that same connection.

- **Evaluation results**: When an instruction, through an Evaluation message
  of that same WebSocket connection, executes with success, the device should
  send back a corresponding "Evaluation result" message described here.

  Evaluation results messages should be UTF-8 encoded JSON with the following
  keys:

  - `type` (string): Always set to `"eval-result"`. This allows the server
    and inspectors to identify that this is an Evaluation result message.

  - `value` (object): Object with the following keys:

    - `id` (string): The same identifier that was sent alongside the
      corresponding original Evaluation message.

      Can be used if multiple evaluation messages were sent to know
      which result is about which evaluation.

    - `data` (string|undefined): The optional result itself, transformed
      to a string format by a method of the RxPaired-client choosing.

- **Evaluation errors**: When an instruction, through an Evaluation message
  of that same WebSocket connection, throws while executing, the device should
  send back a corresponding "Evaluation error" message described here.

  Evaluation errors messages should be UTF-8 encoded JSON with the following
  keys:

  - `type` (string): Always set to `"eval-error"`. This allows the server
    and inspectors to identify that this is an Evaluation error message.

  - `value` (object): Object with the following keys:

    - `id` (string): The same identifier that was sent alongside the
      corresponding original Evaluation message.

      Can be used if multiple evaluation messages were sent to know
      which error is about which evaluation message.

    - `error` (object): Object with the following keys:

      - `name` (string | undefined): Optional `name` property on the
        corresponding error JavaScript object thrown.

      - `message` (string | undefined): Optional `message` property on
        the corresponding error JavaScript object thrown.

- **logs**: Other messages that do not correspond to either of the preceding
  conditions are all considered "logs".

  They should be encoded as an UTF-8 string with the following format:
  `<TIMESTAMP> [<LOG_NAMESPACE>] <LOG_MESSAGE>`

  Where:

  - `<TIMESTAMP>` is the monotically-increasing timestamp in milliseconds
    produced by the same method than the "Initial Message" sent by the
    device.

  - `<LOG_NAMESPACE>` is an identifier for the type of log. It is generally
    correlated to the level of the logs (e.g. `error`, `debug` etc.)
    but may also be used to identify another category of log (e.g. `Network`
    for Network-related log).

  - `<LOG_MESSAGE>` is the logged message itself.

    The message should not be longer than the maximum length configured by
    the RxPaired-server (see server flags), which is expressed in UTF-16
    code units (JavaScript!). If the message is actually longer, it will be
    truncated when received by the server and inspectors - which may render
    it unusable.

#### `/!notoken/<SERVER_PASSWORD>`

**OR** just `/!notoken` if there is no password.

Where:

- `<SERVER_PASSWORD>` is the server's password if configured (see server
  flags).

**NOTE**: This route could have been disabled depending on the flags associated
to the RxPaired-server.

Same behavior and messages than for the `/<TOKEN_ID>` route excepted that a
token will be automatically generated by the server. This token will have the
default token expiration (see server flags) and be removed based on the same
rules that non-persistent tokens generated through the inspector (see
corresponding route).

This token wont be communicated to the device, but:

- If the right flags have been set, it will be present in the name of the
  corresponding log file generated on disk by the server.

- The `/!list` route, exposed to the inspector, will list that token,
  allowing RxPaired-inspectors to listen to it.

#### Fallback to HTTP POST

In the case where WebSocket connections are not supported on the current
device, the device script might actually rely on HTTP POST instead of a
WebSocket connection to send messages to the server.

In that scenario, URLs stay the same, but with the following API changes:

- Instead of keeping a WebSocket connection open and sending messages as soon
  as wanted, a device will here perform multiple HTTP POST requests at a
  regular interval, each grouping all messages that happened since the last
  HTTP POST for that same URL.

  That interval should generally happen more often than every 5 seconds so the
  server may quickly determine whether a device is not relying on a token
  anymore. If no message have been generated in that interval, the device should
  just send a request with an empty body to signal that it is still using the
  given token even though it has no message to send.

  Consequently what we could call a single "session" with a given token is less
  explicit than when relying on a WebSocket connection. With a WebSocket
  connection, it can be assumed that a "session" is linked to the WebSocket
  connection's lifespan. For HTTP POST requests, where there are multiple
  regular requests, it can be assumed instead that a session is terminated if
  the device didn't send a message with a given token in at least the last 30
  seconds (as messages are supposed to be sent by the device every 5 seconds at
  worst, 30 seconds - we rely on huge margins here - is a good indicator that
  the device has stopped using the token).

- Only a single HTTP POST request for a given device and token can be in transit
  at once. If an HTTP POST request hasn't yet answered from the point of view
  of a device, it should not send any new HTTP POST request until that request's
  response has been obtained.

  This is to enforce in a very simple way that order between messages is kept.

- If any HTTP POST request does not answer with an HTTP 2xx status code (post
  potential HTTP redirections) or if the request does not end succesfully due to
  any error, the device should abort sending logs in its current session.

- A single HTTP POST request can transport multiple messages at once.
  To allow separation of such messages, the device should always send them as a
  JSON Array, in chronological order (older first).

- The so-called **Initial Message** sent by the device is only sent once by a
  device through a given "session": only the first HTTP POST request linked to
  that session should transport that message.

  If, in what was assumed to be an-already created session, a new **Initial
  Message** is received from a device, it should be assumed that this is a new
  session with that token.

- If using the `/!notoken` route, the server will send back the generated token
  for that connection as a response for that HTTP POST request.

  The client should then use that token for subsequent HTTP POST requests which
  should thus now be on the `/<TOKEN_ID>` URL.

- In HTTP POST mode, the server doesn't send back any message to the device. As
  such, instruction evaluation is not an available feature in that mode.

- The server should treat such individual messages received through HTTP POST
  the same way than through the default WebSocket mode.
