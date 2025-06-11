# RxPaired-server

This directory is the home of the `RxPaired-server`, the "server" part of the
RxPaired tool.

Its role is to listen and emit on its WebSocket port for:

- metadata coming from the tested device

- information requests coming from the web inspector (the webpage allowing to
  inspect what's going on on the device).

To be able to match devices to the right web inspectors, a system of "tokens" is
in place. Tokens are strings which identify logs coming from a specific device,
and allow an RxPaired-inspector to subscribe to them by communicating that same
token to the server.

Usually, tokens need first to be declared by web inspectors before a device can
contact the server with it, yet other methods exist to let the device declare
new tokens itself instead. This is all indicated in the web inspector's pages
and by the API documentation below.
