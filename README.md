# RxPaired: RxPlayer's Able Inspector for REmote Debugging

This repository contains the RxPaired tool, a lightweight remote inspector adapted for
devices low on resources which displays supplementary indicators mostly useful when
using the [RxPlayer](https://github.com/canalplus/rx-player) library.

![screenshot of RxPaired](./screenshot.png)

This project is functional and is regularly used at Canal+ for debugging media
applications relying on the RxPlayer.

Its key features are:

- Minimal influence on the device's CPU and memory resources when compared with
  Chrome's inspector and tools like weinre.

  _This debugger can run for multiple hours without a noticeable performance
  impact, whereas chrome remote debugger lasted only a few minutes on the more
  constrained devices._

- Ability to see in real time logs and useful playback indicators: which audio and
  video qualities are buffered at which position, information on network requests,
  evolution of the buffer's health etc.

- Possibility to send any JavaScript instruction to the device.

- "Time travel": Possibility to see the known playback conditions and its related
  indicators at the time a log was sent.

- Possibility to store and export logs to either import them later or open them
  in your own editor.

- It can be started even on production on any device and can be triggered
  during runtime.

## Table Of Contents

- [Quick start](#quick-start)
- [What is it?](#what-is-it)
- [How to use it?](#how-to-use-it)
- [How does it work?](#how-it-works)
- [Why creating this tool?](#why-creating-this-tool)

<a class="anchor" href="#quick-start"></a>

## Quick start

To quickly check if this tool can help you, you can test it easily:

1. Make sure `npm` is installed and call:

   ```sh
   npx rx-paired
   ```

   _(Note: Optionally, you can update the port it relies on, call
   `npx rx-paired --help` to have more information on this)._

2. In a web browser, go to the inspector page which should now be served at
   [http://127.0.0.1:8695](http://127.0.0.1:8695).

3. For our test, we will use the `example` token. Define it in the corresponding
   input and click on the `Use now` button to enable it. You will be redirected
   to a debugging page for that token.

4. In another browser tab, go to [the RxPlayer demo
   page](https://developers.canal-plus.com/rx-player/) (any page with the
   RxPlayer will do, but the `RxPlayer` JavaScript class - **not an
   instance** - needs to be accessible, see the script below).

   Open your browser's JavaScript console on that page and enter this code to
   dynamically link the inspector:

   ```js
   import("http://127.0.0.1:8695/client.js#example")
     .then(() => {
       window.__RX_INSPECTOR_RUN__({
         url: "http://127.0.0.1:8695/client.js#example",
         // For other pages: the RxPlayer class needs
         // to be accessible and communicated here
         playerClass: RxPlayer,
       });
       console.info("Inspector initialized with success!");
     })
     .catch((error) =>
       console.error("Failed to dynamically import inspector:", error),
     );
   ```

5. Play a content in that page.

6. Go back to the inspector page. You should now see logs and graphs about
   playback!

If you want to understand how it all works and how to use this in more complex
cases, keep reading below.

<a class="anchor" href="#what-is-it"></a>

## What is it?

RxPaired was first and foremost created to improve debugging and manual testing
sessions on resource-constrained devices using the RxPlayer.

It aims to redirect logs received on the tested device to a web page (generally loaded
on another device) while using the minimum possible resources on the tested device.

This web page also automatically exploits those logs to produce helpful graphs and
metrics about what's currently happening with the player: how much data is buffered, of
what audio and video quality etc.

You can also emit JavaScript instructions from the webpage to the device, as well
as get responses back.

Yet, this tool was also written with modularity in mind. It should thus be very
easy to remove the RxPlayer "modules" from the web inspector of RxPaired, and replace
them by another logic, even for other usages than for media streaming.

<a class="anchor" href="#how-to-use-it"></a>

## How to use it?

### Step 1 (simple): Running only the log server part

If you just want to obtain formatted logs and don't care about the inspector
(the remote debugger part), it is much simpler to just run RxPaired with the
`--no-inspector` option.

First make sure `npm` (node package manager) is installed and run in your
terminal:

```sh
npx rx-paired --no-inspector
```

This will just start a server listening for logs and make the client script
(usage described below) directly accessible, either through an URL or by
copy-pasting the file.

_Note: when copy-pasting, don't pay attention to the `FORCED_TOKEN` variable
found inside this script, this is only needed when running with an inspector._

### Step 1 (alternate): Running the full package, with a remote inspector

The full RxPaired tool also includes its "inspector", a remote debugger
displaying metrics about playback and allowing you to send instructions to the
device.

To run the full RxPaired package with the inspector included, enter in a
terminal:

```sh
npx rx-paired
```

You can then load RxPaired's inspector pages by going to the outputed URL
([https://127.0.0.1:8695](https://127.0.0.1:8695) by default).
You will have instructions allowing to generate a debugging "token" (multiple
tokens can also be created to allow inspection of multiple devices
simultaneously) and then, once you navigated to that token's page, ways to
obtain the client script (more details on how to use it below).

### Step 2: Linking the client script to your application

In step 1, you should either have obtained an URL, a file, or both, to a "client
script". It will now need to be added to your application so it can send logs.

This client script monkey-patches some logging and networking logic to redirect
logs to RxPaired's server through a WebSocket connection. To function optimally,
it needs to be loaded before all other code in your application.

We thus recommend you to link this client script through a `<script>` tag
inserted before all other `<script>` tags from the page you're debugging.

For example if your HTML page looks like this:

```html
<html>
  <head>
    <title>My Page</title>
    <script src="./my-bundle.js"></script>
    <script src="./other-dependency.js"></script>
  </head>
  <body>
    <!-- ... -->
  </body>
</html>
```

And if your client script can be accessed through the url
`http://127.0.0.1/my-script-url`, you can write:

```html
<html>
  <head>
    <title>My Page</title>
    <script src="http://127.0.0.1/my-script-url"></script>
    <script src="./my-bundle.js"></script>
    <script src="./other-dependency.js"></script>
  </head>
  <body>
    <!-- ... -->
  </body>
</html>
```

If you would prefer to rely on the client script file instead, you can copy and
paste it at the same location:

```html
<html>
  <head>
    <title>My Page</title>
    <script>
      // THE CLIENT SCRIPT'S CODE GOES HERE
    </script>
    <script src="./my-bundle.js"></script>
    <script src="./other-dependency.js"></script>
  </head>
  <body>
    <!-- ... -->
  </body>
</html>
```

_NOTE: Only when running RxPaired with an inspector and copy-pasting the file,
you'll need to include your token in the file's content manually. You can follow
the instructions in the corresponding inspector page for more information._

Once any of those solutions is implemented, you can launch your application.
A log file should now be created locally containing logs from it, and, if
you ran the inspector, you should now be able to perform live debugging on
it.

### NOTE: When debugging on another device

In previous examples logs are sent and the client script is fetched through HTTP
connections, not HTTPS ones.
This can become problematic especially when debugging remote devices because
HTTP connections will here most likely be blocked.

RxPaired exposes at most two HTTP ports:

1. a WebSocket port to communicate with inspectors and devices.
2. an HTTP port to serve both the inspector pages and client script.

The HTTP server is not mandatory as the client script can just be
copy-pasted in your application's HTML page (instead of fetching it through an
URL).
However, the WebSocket port is used inside the client script and thus would need
to be accessed through a secure connection.

Thankfully, [easy and free solutions exist](https://github.com/anderspitman/awesome-tunneling?tab=readme-ov-file)
to proxify local HTTP servers from a remote HTTPS URL.
[`ngrok`](https://ngrok.com/docs/getting-started/) for example is known to be
functional but may necessitate you to login first. Other solutions should work
but weren't tested by us (most notably WebSocket connections have to be properly
redirected).

When using such a solution, you will need to perform a small update on the
client script: the `__FORCED_SERVER_URL__` variable on top of this file should
now be set to the new HTTPS URL redirecting to your local port which listens for
device logs (`22626` by default).

The client script can then be copy-pasted in your application's page as
described in step 2 (if you're relying on an inspector, don't forget to also
update `__FORCED_TOKEN__`).

## RxPaired on a server

If you plan to make RxPaired more globally accessible through a Web Server,
building and running independently its three modules is more configurable:

1. start RxPaired-server: see [./SERVER.md](./SERVER.md)
2. build and optionally serve the RxPaired-client script that will be put on the
   device: see [./CLIENT.md](./CLIENT.md)
3. build and serve the RxPaired-inspector web page: see
   [./INSPECTOR.md](./INSPECTOR.md).

For now, this will require you to first either clone the repository or to go to
the directory `npm` installed RxPaired in. We're also thinking of easier
solutions for doing that in the future.

<a class="anchor" href="#how-it-works"></a>

## How does it work?

RxPaired comes in three parts:

1. The inspector web application, found in the `./inspector` directory.

   This is the page that will be used to inspect what's going on on the device remotely
   from a browser.
   This page can also send instructions directly to the device (only through the page's
   console for now, as the user interface for this is not yet developped).

   Under the hood, this inspector relies on a [WebSocket](https://en.wikipedia.org/wiki/WebSocket)
   connection with the RxPaired's server to receive the device's source information
   (logs, requests etc.) and it contains some logic to construct graphical "modules"
   based on those logs: charts, curated information about playback etc.

   Note that multiple inspector pages can be created at the same time for multiple
   devices and multiple inspector pages can also be linked if they want to the same
   device. This is done through a system of "tokens", as explained in the inspector's
   main web page.

2. A client-side script to deploy on the device, found in the `./client` directory.

   This script mostly [monkey-patches](https://en.wikipedia.org/wiki/Monkey_patch) console
   and request-related functions so any interaction with those is communicated with
   the RxPaired's server through a WebSocket connection.

   This script is also able to execute commands sent from the Inspector web-application
   (which goes through the exact same WebSocket connection).

   The client-side script has a minimal amount of processing logic to communicate those
   information, so we can limit the influence on the device's performance. A single
   long-lived WebSocket connection is also used instead of multiple HTTP calls for those
   same considerations.

3. The server, written in the `./server` directory, on which the two precedent parts
   rely.

   The server is very configurable: it can for example set-up a password to protect its
   access, shutdown when abnormal behavior is detected (like too many device or
   inspector connections, too many wrong password, too many WebSocket messages sent),
   create and keep log files for each inspected devices, give a maximum lifetime for
   each token, change the port it listens to etc.

<a class="anchor" href="#why-creating-this-tool"></a>

## Why creating this tool?

The RxPlayer is an advanced media player which is used to play contents on a large panel
of devices. Like for most software, we sometimes need to start debugging sessions on one
of those, e.g., to investigate curious behavior.

As a player for the web platform, the RxPlayer can often profit from already available
remote web inspectors to do just that from our PC. Most notably, the featureful Chrome
remote debugger is a complete tool that is most often available.
In cases where it isn't, [weinre](https://people.apache.org/~pmuellr/weinre/docs/latest/Home.html)
was also a very useful tool in the past.

However those tools have limitations on some devices.
The one that hindered us the most, is that those tools often use a lot of resources:
we're sometimes not even able to use the Chrome Remote Debugger for more than a minute on
some targets with low memory (smart TVs, set-top boxes, ChromeCast...) and even in the
time window where we can, the resource usage those tools take might provoke large
side-effects and is a very frequent source of [heisenbug](https://en.wikipedia.org/wiki/Heisenbug)
for our team.

When what we wanted to do was just to recuperate logs from the device, this became very
annoying.

After initial even-lighter tools like a simple HTTP, then
[WebSocket-based](https://gist.github.com/peaBerberian/5471f397b6dd3682bc5980d11cfc4421)
log server, we noticed that we could do even better in terms of usability and usefulness
than a simple log server: our own remote inspector tool, whose core goal would be
lightweightness and, why not, also have the advantage of being specialized for the
debugging of the RxPlayer.

Enter RxPaired: The **RxP**layer's **A**ble **I**nspector for **Re**mote **D**ebugging
