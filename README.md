[![CI](https://github.com/cloudydeno/ddp/actions/workflows/deno-ci.yaml/badge.svg)](https://github.com/cloudydeno/ddp/actions/workflows/deno-ci.yaml)

# `@cloudydeno/ddp` on JSR

This package contains alternative client and server modules for DDP.

[Meteor introduced and primarily uses DDP](https://blog.meteor.com/introducing-ddp-6b40c6aff27d)
for "live data" communications between a webapp and a backend.

Sometimes you may want to interact with a Meteor server from somewhere else,
such as a CLI, a cronjob, or a plug-in to another app.
Or maybe you want to provide a Meteor-like backend for an existing app to use,
without inheriting the rest of Meteor's server stack.
In these cases the `@cloudydeno/ddp` package may be able to help.

## Quick Overview of DDP

DDP has several defining characteristics:

* DDP features a publication system for the backend to furnish subsets of MongoDB collections
  to the client, so that the webapp can query documents just like the backend.
  Updates to published documents on the server get sent to connected clients
  so that pages can update immediately to display the latest information.

* The other primary mechanism is client-to-server RPC calls.
  Clients call RPCs by-name with zero or more arguments.
  Logging in to the server is typically done with a specific RPC called `login`.

* DDP uses a JSON encoding called "EJSON" which allows for additional data types
  such as `Date` and `Uint8Array` to be transfered without manual conversion.

## Client Usage

Add the package as always:

```
deno add jsr:@cloudydeno/ddp
```

A basic client can be set up like so:

```ts
import { DdpConnection } from "@cloudydeno/ddp/client";

const client = new DdpConnection('https://my-app.com', {
  encapsulation: 'raw', // or 'sockjs'
  autoConnect: true,
});
```

The connection will start up in the backend due to `autoConnect: true`.
You don't have to wait for it; your first calls will transparently wait instead.

If you want to wait for a healthy connection you can try a snippet like this:

```ts
await client.liveStatus.waitFor(x => x.status == 'connected');
```

### Authenticating

To login to the server, you can provide a callback to provide a token:

```ts
import { DdpConnection } from "@cloudydeno/ddp/client";

const client = new DdpConnection('https://my-app.com', {
  encapsulation: 'raw',
  autoConnect: true,
  fetchAuthFunc: () => ({
    resume: DdpResumeToken,
  }),
});
```

In a server-to-server environment, you may want to fetch login details dynamically,
such as short-lived JWT/OIDC tokens.
In this case, simply make `fetchAuthFunc` async:

```ts
import { DdpConnection } from "@cloudydeno/ddp/client";

const client = new DdpConnection('https://my-app.com', {
  encapsulation: 'raw',
  autoConnect: true,
  fetchAuthFunc: async () => ({
    // your Meteor server has to implement a 'jwt' login method for this!
    jwt: await retrieveMyJwt(),
  }),
});
```

The callback will be rerun when the client reconnects after a dropped connection.
This ensures a fresh token will always be available.

### Calling Methods

The client's `callMethod(name, params)` function accepts a list of EJSON-able values
to be sent to the server, and returns the response as one EJSON-able value.

```ts
await client.callMethod('like-post', [post._id]);

const weather = await client.callMethod('query-weather', ['Berlin', 'DE']);
console.log(`Currently it is ${weather.degreesC}°C`);
```

If the connection to the server is not currently online,
the method call will be held in a local queue and sent to the server once possible.

### Subscribing to Data

> [!NOTE]
> The ergonomics of the subscription system are still a work in progress.
> The below API may change in future 'minor' version bumps.

Rough example of using a subscription:

```ts
// Set up a subscription without parameters
const sub = client.subscribe('my-posts');

// Wait for the subscription to be 'ready'
// Otherwise we might query our collection before we have any data
await sub.liveReady.waitForValue(true);

// Set up a reference to the related collection.
// Publications aren't explicitly tied to collections by DDP--
// your program will have to know which collection the data was published into.
const collection = client.getCollection('posts');

// Query all published documents for the collection.
// This method is async but will return nearly immediately from the local document cache.
// It never sends the query to the server.
const documents = await collection.find().fetchAsync();
```
