# RxPaired-inspector

## How to build and run it

To build it, you first need to install its dependencies.

To do that, make sure that you have `npm` installed and this repository cloned.
Then go to this directory on a terminal, and type:

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

In that new `rx-paired.config.json` file, you'll need to set two URLs:

1. `serverUrl`:

   This will be the WebSocket address `RxPaired-server` is listening to to exchange
   metadata between devices and inspectors.

   If you didn't start the `RxPaired-server` yet, you should first start doing this by
   using `npm run serve --workspace=server`.

   Note that the URL already present uses the default port used by the server. If your
   server runs locally in the default config, you might not actually have to update it.

   In most cases however, you might want to use HTTPS/WSS instead of the default HTTP/WS
   (to make the `RxPaired-Client` runnable in HTTPS pages).
   There, you might need to update this value to the actual HTTPS URL used.

2. `deviceScriptUrl`:

   This is the URL the `RxPaired-Client` (the script that will be deployed to devices)
   is available at.

   You can leave this URL empty if you do not wish to serve that script though HTTP(S)
   means.
   In that case, you will have to copy/paste the content of that script into the HTML
   page running on the device.

Once this is done, you can start building the `RxPaired-inspector`.

In your terminal, type:

```sh
npm run build:min --workspace="inspector"
```

You can now start using the `RxPaired-inspector`, you just need to serve both the
`inspector/index.html` and the newly generated `inspector/inspector.js` files.

You can do so easily by typing in a terminal:

```sh
npm run serve --workspace="inspector"
```

Multiple persons can even build and serve their own `RxPaired-inspector` while
debugging the same devices as long as the same `RxPaired-server` is used.

Though you might prefer the simplicity of just letting a "real" HTTP(S) server serve both
of those files instead. This way this build step does not need to be repeated for each
user.
