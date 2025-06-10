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

## Commands

RxPaired allows to remotely send a "command" to interact with one of the players
running on the device.

Those commands allow to perform actions such as seeking, pausing, reloading the
content etc.

Note that this is completely optional. It just allows to improve the inspector
by allowing it to control playback remotely.

### List of available commands

The list of available commands are:

- `stop`: Stop playback for the current playing content, if one.

- `pause`: Pause playback for the current playing content, if one is playing.

- `resume`: Resume playback for the current playing content, if one is paused.

- `mute`: Mute audio volume in the associated player.

- `unmute`: Unmute audio volume in the associated player.

- `seekAbsolute`: Set the playback position to a particular value in seconds
  given in argument. Only apply if a content is currently playing on that
  player.

- `seekRelative`: Set the playback position relatively to the one currently
  playing, by exploiting the signed floating point value in argument (indicated
  as a number of seconds). Only apply if a content is currently playing on that
  player.

- `setPlaybackRate`: Modify the playback speed in the associated player to the
  given value.

- `setWantedBufferAhead`: Modify the amound of buffer pre-loaded by default when
  loading a content. The corresponding value

- `reload`: If a content is currently playing, re-load that content at roughly
  the same position. If no content is currently playing on that player but a
  content was previously playing on it, re-load that previous content at roughly
  its last played position.

A player can implement any subset of these commands, or all of them.
The more commands are implemented, the more it can be controlled by RxPaired's
inspector.

### Declaring/removing a player with its commands

To declare a new player instance and its associated commands, the client script
creates a `__RX_PAIRED_PLAYERS__` object globally (defined in `window`).

This object has two methods:

- `add`, to add a new player. This function should be called when your player
  is instantiated and will declare the available commands.

- `remove`, to remove a previously-added player. This function should be called
  when your player is diposed, to free its resources.

`add` is a function which takes an object containing the following propoerties:

- `version` (`number`): Has to be set to `1`

- `name` (`string`): The preferred name to refer to the player that is currently
  being added. Will be shown in the inspector.

- `key` (`object`): Unique reference that will also be used to remove that
  player through the `remove` function.

- `commands` (`Object`): Object where the keys are command names as `string` and
  the values are the `function` implementations for those commands.

  Those implementations may be called with arguments (it makes sense
  particularly for commands like `seekRelative`, `seekAbsolute`,
  `setPlaybackRate` etc.).
  Those arguments will always be under an `Array` of `string` type.
  If a `number` is wanted, it will need to be converted from a string to a
  number.

  The length of that array should also be checked and the input, as it may come
  from the network, should always be validated.

`remove` is a function that should be called when the player is destroyed /
disposed. It takes the same `key` you provided to `add` as a unique argument.

### Example

Here's an example implementation, taking the RxPlayer as reference:

```js
/**
 * Add the commands for a new RxPlayer instance.
 * @param {RxPlayer} player
 */
function registerPlayerForRxPaired(player) {
  globalScope.__RX_PAIRED_PLAYERS__?.add({
    version: 1,
    name: "RxPlayer",
    key: player,
    commands: {
      seekAbsolute(args) {
        const pos = +args[0];
        if (!isNaN(pos)) {
          player.seekTo(pos);
        }
      },
      seekRelative(args) {
        const pos = +args[0];
        if (!isNaN(pos)) {
          player.seekTo({ relative: pos });
        }
      },
      setPlaybackRate(args) {
        const pr = +args[0];
        if (!isNaN(pr)) {
          player.setPlaybackRate(pr);
        }
      },
      setWantedBufferAhead(args) {
        const wba = +args[0];
        if (!isNaN(wba)) {
          player.setWantedBufferAhead(wba);
        }
      },
      mute() {
        player.mute();
      },
      unmute() {
        player.unMute();
      },
      reload() {
        player.reload();
      },
      pause() {
        player.pause();
      },
      resume() {
        player.play();
      },
      stop() {
        player.stop();
      },
    },
  });
}

/**
 * Free resources associated to a previously-created RxPlayer instance.
 * @param {RxPlayer} player
 */
function unregisterPlayerForRxPaired(player) {
  globalScope.__RX_PAIRED_PLAYERS__?.remove(player);
}
```
