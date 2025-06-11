# RxPaired-client

## How to build RxPaired-client and what to do with it

To build it, you first need to install its dependencies.

To do that, make sure that you have `npm` installed and this repository cloned.
Then in the root directory, open a terminal and type:

```sh
npm install
```

If not already done, you have to create a `rx-paired.config.json` file in the root
directory.
You can base yourself on the `rx-paired.config.example.json` file:

```sh
# in root directory
cp rx-paired.config.example.json rx-paired.config.json
```

### The `serverUrl`

In that new `rx-paired.config.json` file, you'll need to set one URL: the
`serverUrl`.

This will be the WebSocket address `RxPaired-server` is listening to for
`RxPaired-client` connections and messages.

If you didn't start the `RxPaired-Server` yet, you should first start doing this by
using `npm run serve --workspace=server`.

Note that the URL already present uses the default port used by the server. If your
server runs locally in the default config, you might not actually have to update it.

In most cases however, you might want to use HTTPS/WSS instead of the default HTTP/WS
(to make the `RxPaired-Client` runnable in HTTPS pages).
There, you might need to update this value to the actual HTTPS URL used.

### Building the script

Once this is done, you can start building the `RxPaired-client`.

In your terminal, type:

```sh
npm run build:min --workspace="client"
```

The script should now be built at `.client/client.js`. Note that it relies on ES6, if
your devices are only ES5-compatible you can rely on `./client/client.es5.js` instead.

### Optionally serving the script

At last, you have two choices in how to deploy that script:

- Either you store it on an HTTP(S) server, in which case you'll have to
  indicate its URI to the `RxPaired-inspector` (more information on that
  in `INSPECTOR.md`).

  This is the recommended choice.
  If you choose to go this way, the `RxPaired-inspector` will conveniently
  provide you updated URLs (it adds a number-sign token to it) as well as
  an handy HTML `<script>` element to include on your application's HTML
  page(s) (the one running on the device).

- Or if you don't want to involve an HTTP(S) server in here, you may just need
  to manually deploy the whole script yourself on your applications manually.

In both cases, `RxPaired-inspector` will give you all the necessary instructions.
